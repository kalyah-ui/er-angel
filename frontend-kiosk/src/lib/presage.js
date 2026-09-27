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
 *     499 -> capture was cancelled via POST /cancel (not a real failure)
 *     500 -> { error, detail }
 *   POST /cancel  -> { ok: true, wasCapturing: boolean }
 *     Tells the agent to stop an in-progress capture (stops the SDK,
 *     resolves the pending /capture request with 499). No-op if nothing
 *     is running. Never throws from this client's perspective.
 *
 * The agent owns the camera, so the kiosk must not open it too.
 */
import { CAPTURE_SECONDS, KIOSK_CAPTURE_TIMEOUT_SECONDS } from "./captureConfig.js";

const AGENT_URL = import.meta.env.VITE_PRESAGE_URL || "http://localhost:4600";

// Capture timing lives in captureConfig.js (the one place to change it).
export const CAPTURE_DURATION_MS = CAPTURE_SECONDS * 1000;

// Longer than the agent's own maximum (poor framing pauses the countdown), so
// the kiosk never gives up while the agent is still legitimately capturing.
const CAPTURE_TIMEOUT_MS = KIOSK_CAPTURE_TIMEOUT_SECONDS * 1000;
const HEALTH_TIMEOUT_MS = 1500;
const STATUS_TIMEOUT_MS = 1500;
const CANCEL_TIMEOUT_MS = 1500;

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

// Thrown by captureFromAgent when the capture was cancelled (either by the
// caller's own signal firing, or because the backend replied 499 after a
// POST /cancel). Callers should treat this as "the user backed out," not as
// a capture failure -- e.g. don't route it to a front-desk/error screen.
export class CaptureCancelledError extends Error {
  constructor() {
    super("capture cancelled");
    this.name = "CaptureCancelledError";
  }
}

/**
 * Real capture from the agent. Throws CaptureCancelledError if `signal` is
 * aborted (by the caller) or the agent itself reports the capture was
 * cancelled (409/499 style). Throws a plain Error on other failures
 * (unreachable/timeout/busy/empty result).
 *
 * `signal` is optional -- pass the same AbortController you plan to use for
 * cancelCapture() so the fetch itself can be torn down immediately instead
 * of waiting on the backend's response.
 */
export async function captureFromAgent({ signal } = {}) {
  const timeoutSignal = AbortSignal.timeout(CAPTURE_TIMEOUT_MS);
  const combinedSignal =
    signal && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeoutSignal]) : signal || timeoutSignal;

  let res;
  try {
    res = await fetch(`${AGENT_URL}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration_ms: CAPTURE_DURATION_MS }),
      signal: combinedSignal,
    });
  } catch (err) {
    // AbortSignal.any isn't available in every runtime this may target, so
    // if only the plain `signal` was passed and it fired, the fetch throws
    // an AbortError here rather than resolving with a response at all.
    if (signal?.aborted) throw new CaptureCancelledError();
    throw err;
  }

  if (res.status === 499) throw new CaptureCancelledError();
  if (!res.ok) throw new Error(`agent /capture returned HTTP ${res.status}`);

  const vitals = normalizeVitals(await res.json());
  if (vitals.heart_rate == null) throw new Error("agent returned no heart rate (no samples decoded)");
  return vitals;
}

/**
 * Tells the agent to stop an in-progress capture. Fire-and-forget from the
 * caller's perspective -- never throws, since the frontend should proceed
 * with navigating away regardless of whether this network call succeeds.
 * Pair this with aborting the same `signal` passed to captureFromAgent so
 * the fetch there doesn't hang around waiting for the 499.
 */
export async function cancelCapture() {
  try {
    const res = await fetch(`${AGENT_URL}/cancel`, {
      method: "POST",
      signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.wasCapturing;
  } catch {
    return false;
  }
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

/**
 * Polled by the capture UI while a capture is running, to show a live
 * framing hint (e.g. "Place more of the chest in view") from the agent's
 * validationStatus stream. Never throws -- a missed poll just means no
 * hint update this tick, not a broken capture.
 */
export async function fetchStatus() {
  try {
    const res = await fetch(`${AGENT_URL}/status`, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
    if (!res.ok) return null;
    return res.json(); // { collecting, code, hint, timestamp }
  } catch {
    return null;
  }
}