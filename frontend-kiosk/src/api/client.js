const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Backend is down, unreachable, too slow, or erroring -- send the patient to the front desk.
export class BackendUnavailableError extends Error {}
export class NotFoundError extends Error {}

async function request(path, { method = "GET", body, timeoutMs = 10000 } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new BackendUnavailableError(`${method} ${path}: ${err.message}`);
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
export function submitReading({ patient_id, heart_rate, breathing_rate, stress_score, is_baseline }) {
  return request("/reading", {
    method: "POST",
    body: { patient_id, heart_rate, breathing_rate, stress_score, is_baseline },
    timeoutMs: 45000,
  });
}

// Throws NotFoundError for an unknown patient number.
export function getPatient(id) {
  return request(`/patients/${encodeURIComponent(id)}`);
}

export async function getBaseline(patientId) {
  const readings = await request(`/reading/patient/${encodeURIComponent(patientId)}`);
  return readings.find((r) => Number(r.is_baseline)) || null;
}
