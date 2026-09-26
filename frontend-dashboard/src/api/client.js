const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export async function fetchPatients() {
  const res = await fetch(`${BASE_URL}/patients`);
  if (!res.ok) throw new Error("failed to fetch patients");
  return res.json();
}

export async function fetchAlerts() {
  const res = await fetch(`${BASE_URL}/alerts`);
  if (!res.ok) throw new Error("failed to fetch alerts");
  return res.json();
}

export async function acknowledgeAlert(id) {
  const res = await fetch(`${BASE_URL}/alerts/${id}/ack`, { method: "POST" });
  if (!res.ok) throw new Error("failed to acknowledge alert");
  return res.json();
}

/**
 * Simple polling helper -- good enough for a hackathon demo, no websockets
 * needed. Call the returned stop() function on unmount.
 */
export function poll(fn, intervalMs, onData, onError) {
  let cancelled = false;

  async function tick() {
    try {
      const data = await fn();
      if (!cancelled) onData(data);
    } catch (err) {
      if (!cancelled) onError?.(err);
    } finally {
      if (!cancelled) setTimeout(tick, intervalMs);
    }
  }

  tick();
  return () => { cancelled = true; };
}
