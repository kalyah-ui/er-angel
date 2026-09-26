const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

async function request(path, options) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) throw new Error(`${options?.method || "GET"} ${path} failed (${res.status})`);
  return res.json();
}

// GET /patients -- each patient has baseline_reading, latest_reading, latest_alert (or null)
export function fetchPatients() {
  return request("/patients");
}

// GET /alerts -- every alert (acknowledged included), with patient_name
export function fetchAlerts() {
  return request("/alerts");
}

export function acknowledgeAlert(id) {
  return request(`/alerts/${id}/ack`, { method: "POST" });
}

export function resetDemo(seed = true) {
  return request("/admin/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seed }),
  });
}

/**
 * SQLite datetime('now') gives "YYYY-MM-DD HH:MM:SS" in UTC with no zone
 * marker, which Date would otherwise parse as local time.
 */
export function parseUtc(sqliteTimestamp) {
  if (!sqliteTimestamp) return null;
  const iso = sqliteTimestamp.includes("T") ? sqliteTimestamp : sqliteTimestamp.replace(" ", "T");
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Simple polling helper -- good enough for a hackathon demo, no websockets
 * needed. Waits for each request to finish before scheduling the next, so a
 * slow backend never stacks up requests. Call the returned stop() on unmount.
 */
export function poll(fn, intervalMs, onData, onError) {
  let cancelled = false;
  let timer;

  async function tick() {
    try {
      const data = await fn();
      if (!cancelled) onData(data);
    } catch (err) {
      if (!cancelled) onError?.(err);
    } finally {
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    }
  }

  tick();
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
