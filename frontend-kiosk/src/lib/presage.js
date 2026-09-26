/**
 * Talks to the Presage capture agent (presage-agent/, run by the kiosk
 * device next to the webcam). Contract, from presage-agent/src/index.js:
 *
 *   GET  /health  -> { ok: true }
 *   POST /capture   body { duration_ms }  (agent default 20000)
 *     200 -> { heart_rate, breathing_rate, stress_score, face_asymmetry_score, sample_count }
 *            heart_rate/breathing_rate are null if no samples were decoded;
 *            stress_score = EDA (small values, e.g. 0.039) and
 *            face_asymmetry_score (e.g. 0.007, stroke screening) are null
 *            when the agent couldn't measure them
 *     409 -> a capture is already in progress
 *     500 -> { error, detail }
 *
 * The agent owns the camera, so the kiosk must not open it too.
 */
import { CAPTURE_SECONDS } from "./captureConfig.js";

const AGENT_URL = import.meta.env.VITE_PRESAGE_URL || "http://localhost:4600";

// Capture length lives in captureConfig.js (the one place to change it).
export const CAPTURE_DURATION_MS = CAPTURE_SECONDS * 1000;

// Headroom for agent startup/processing on top of the capture itself; after
// this we give up on the agent and use mock vitals instead.
const CAPTURE_TIMEOUT_BUFFER_MS = 15000;
const CAPTURE_TIMEOUT_MS = CAPTURE_DURATION_MS + CAPTURE_TIMEOUT_BUFFER_MS;
const HEALTH_TIMEOUT_MS = 1500;

function toNumber(value) {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

// HR/RR are rounded for display; EDA and face asymmetry are small fractions
// (e.g. 0.039) that the backend's EDA check compares, so they're kept as-is.
export function normalizeVitals(raw) {
  return {
    heart_rate: round1(toNumber(raw?.heart_rate)),
    breathing_rate: round1(toNumber(raw?.breathing_rate)),
    stress_score: toNumber(raw?.stress_score),
    face_asymmetry_score: toNumber(raw?.face_asymmetry_score),
  };
}

export async function isAgentAvailable() {
  try {
    const res = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Real capture from the agent. Throws on unreachable/timeout/busy/empty result. */
export async function captureFromAgent() {
  const res = await fetch(`${AGENT_URL}/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duration_ms: CAPTURE_DURATION_MS }),
    signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`agent /capture returned HTTP ${res.status}`);

  const vitals = normalizeVitals(await res.json());
  if (vitals.heart_rate == null) throw new Error("agent returned no heart rate (no samples decoded)");
  return vitals;
}

const jitter = (spread) => (Math.random() * 2 - 1) * spread;

/**
 * Plausible resting vitals. With a baseline (rescan), stays close to it so an
 * un-overridden rescan reads as stable; without one, centers on HR 72 / RR 14.
 */
export function mockVitals(baseline) {
  const hr = toNumber(baseline?.heart_rate) ?? 72;
  const rr = toNumber(baseline?.breathing_rate) ?? 14;
  return normalizeVitals({
    heart_rate: hr + jitter(baseline ? 3 : 4),
    breathing_rate: rr + jitter(1),
    stress_score: null,
  });
}

/** The jumping-jacks demo: HR +35, RR +5 over the patient's baseline. */
export function elevatedVitals(baseline) {
  return normalizeVitals({
    heart_rate: (toNumber(baseline?.heart_rate) ?? 72) + 35,
    breathing_rate: (toNumber(baseline?.breathing_rate) ?? 14) + 5,
    stress_score: null,
  });
}
