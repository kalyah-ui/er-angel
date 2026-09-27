/**
 * Per-client fixed-window rate limiting (in memory -- one backend process).
 * Keyed by req.ip, which is the real client address behind Caddy (index.js
 * sets "trust proxy"). Over the limit: 429 with Retry-After.
 *
 * @param {object} opts
 * @param {string} opts.name  used in the log line and error message
 * @param {number} opts.max  requests allowed per window
 * @param {number} [opts.windowMs]
 * @param {() => number} [opts.now]  for tests
 */
export function rateLimit({ name, max, windowMs = 60_000, now = Date.now }) {
  const windows = new Map(); // ip -> { count, resetAt }

  return function rateLimitMiddleware(req, res, next) {
    const t = now();
    // Forget finished windows now and then, so the map can't grow forever.
    if (windows.size > 5000) {
      for (const [key, w] of windows) if (w.resetAt <= t) windows.delete(key);
    }

    const key = req.ip ?? "unknown";
    let w = windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + windowMs };
      windows.set(key, w);
    }
    w.count++;
    if (w.count <= max) return next();

    const retryAfter = Math.max(1, Math.ceil((w.resetAt - t) / 1000));
    if (w.count === max + 1) console.warn(`[rate-limit] ${name}: ${key} over ${max}/${windowMs / 1000}s`);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({ error: `too many requests (${name}) -- try again in ${retryAfter}s` });
  };
}

// Header Caddy sets on requests from the public hosted kiosk (and strips
// everywhere else), so only that traffic is limited: the laptop kiosk and
// local development are unaffected.
export const PUBLIC_KIOSK_HEADER = "x-er-angel-public";

/** Rate limits for the public hosted kiosk, per client IP per minute. */
export function publicKioskLimits() {
  const all = rateLimit({ name: "kiosk api", max: 180 }); // /calls/pending polls 20/min
  const perRoute = [
    { method: "POST", test: (p) => p === "/checkin", limit: rateLimit({ name: "check-in", max: 5 }) },
    { method: "POST", test: (p) => p === "/reading", limit: rateLimit({ name: "reading", max: 10 }) },
    { method: "POST", test: (p) => p === "/speak", limit: rateLimit({ name: "speak", max: 30 }) },
    { method: "POST", test: (p) => /^\/patients\/[^/]+\/recheck$/.test(p), limit: rateLimit({ name: "recheck", max: 10 }) },
  ];

  return function publicKioskLimitsMiddleware(req, res, next) {
    if (req.get(PUBLIC_KIOSK_HEADER) !== "kiosk") return next();
    all(req, res, () => {
      const route = perRoute.find((r) => r.method === req.method && r.test(req.path));
      if (!route) return next();
      route.limit(req, res, next);
    });
  };
}
