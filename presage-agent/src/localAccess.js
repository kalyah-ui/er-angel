/**
 * Who may call this agent from a browser. The agent drives the laptop's
 * camera, so only the kiosk's own pages are allowed:
 *
 *   - http://localhost:5173 (the local kiosk dev server) -- always allowed
 *   - anything in KIOSK_ORIGINS (presage-agent/.env, comma-separated), e.g.
 *     the hosted kiosk: KIOSK_ORIGINS=https://kiosk.149-248-60-145.sslip.io
 *
 * A hosted (public HTTPS) kiosk calling http://localhost:4600 is a
 * "local network" request in Chrome. Older Chrome versions send a Private
 * Network Access preflight (Access-Control-Request-Private-Network: true),
 * answered below with Access-Control-Allow-Private-Network: true for allowed
 * origins only. Newer Chrome instead asks the user once per site
 * ("... wants to access other apps and services on this device").
 *
 * Requests with an Origin that isn't allowed get 403 (so other websites
 * can't start or cancel captures). Requests with no Origin (curl, scripts)
 * are unaffected.
 *
 * No dependencies: works as Express middleware or with a plain node:http server.
 */
export const DEFAULT_KIOSK_ORIGINS = ["http://localhost:5173"];

export function allowedKioskOrigins(value = process.env.KIOSK_ORIGINS) {
  const extra = (value ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return [...new Set([...DEFAULT_KIOSK_ORIGINS, ...extra])];
}

export function localAccess(origins = allowedKioskOrigins()) {
  const allowed = new Set(origins);

  return function localAccessMiddleware(req, res, next) {
    const origin = req.headers.origin;
    if (!origin) return next();

    res.setHeader("Vary", "Origin");
    if (!allowed.has(origin)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `origin ${origin} is not allowed to use the camera agent` }));
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "Content-Type");
      if (req.headers["access-control-request-private-network"] === "true") {
        res.setHeader("Access-Control-Allow-Private-Network", "true");
      }
      res.setHeader("Access-Control-Max-Age", "600");
      res.statusCode = 204;
      res.end();
      return;
    }
    next();
  };
}
