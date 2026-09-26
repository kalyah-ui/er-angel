const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
// Hosted backend only: shared secret the server's Caddy checks. Unset locally.
const KIOSK_TOKEN = import.meta.env.VITE_KIOSK_TOKEN || "";

function backendHeaders(extra = {}) {
  return KIOSK_TOKEN ? { ...extra, "X-Kiosk-Token": KIOSK_TOKEN } : extra;
}

// Backend is down, unreachable, too slow, or erroring -- send the patient to the front desk.
export class BackendUnavailableError extends Error {}
export class NotFoundError extends Error {}

async function request(path, { method = "GET", body, timeoutMs = 10000 } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: backendHeaders(body ? { "Content-Type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new BackendUnavailableError(`${method} ${path}: ${err.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new BackendUnavailableError(`${method} ${path}: HTTP ${res.status} -- check VITE_KIOSK_TOKEN matches the server's KIOSK_TOKEN`);
  }
  if (res.status === 404) throw new NotFoundError(`${method} ${path}: not found`);
  if (res.status >= 500) throw new BackendUnavailableError(`${method} ${path}: HTTP ${res.status}`);
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return res.json();
}

export function checkIn({ name, chief_complaint }) {
  return request("/checkin", { method: "POST", body: { name, chief_complaint } });
}

// Rescans wait on Gemini (retries + backup model) when it's enabled, so allow extra time.
export function submitReading({ patient_id, heart_rate, breathing_rate, stress_score, face_asymmetry_score, is_baseline }) {
  return request("/reading", {
    method: "POST",
    body: { patient_id, heart_rate, breathing_rate, stress_score, face_asymmetry_score, is_baseline },
    timeoutMs: 45000,
  });
}

// Throws NotFoundError for an unknown patient number.
export function getPatient(id) {
  return request(`/patients/${encodeURIComponent(id)}`);
}

// PA calls waiting to be announced: [{ id, patient_id, type: "triage" | "recheck", created_at }]
export function fetchPendingCalls() {
  return request("/calls/pending", { timeoutMs: 4000 });
}

// Demo key R: remind this patient to recheck now. Throws NotFoundError for an unknown number.
export function triggerRecheck(patientNumber) {
  return request(`/patients/${encodeURIComponent(patientNumber)}/recheck`, { method: "POST", timeoutMs: 4000 });
}

export function markCallAnnounced(id) {
  return request(`/calls/${encodeURIComponent(id)}/announced`, { method: "POST", timeoutMs: 4000 });
}

// MP3 for a voice line (backend proxies ElevenLabs; the key stays server-side).
// Throws if voice is off or ElevenLabs fails -- callers fall back to browser speech.
export async function fetchSpeech(text) {
  const res = await fetch(`${BASE_URL}/speak`, {
    method: "POST",
    headers: backendHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    let reason = "";
    try {
      reason = (await res.json()).reason || "";
    } catch {
      // non-JSON error body
    }
    throw new Error(`/speak HTTP ${res.status}${reason ? `: ${reason}` : ""}`);
  }
  return res.blob();
}

export async function getBaseline(patientId) {
  const readings = await request(`/reading/patient/${encodeURIComponent(patientId)}`);
  return readings.find((r) => Number(r.is_baseline)) || null;
}
