/**
 * Fallback risk classification used ONLY if every Gemini attempt fails or
 * times out (or GEMINI_ENABLED=false). Never let the demo show a
 * blank/broken state -- always fall back to something defensible. The
 * wording is deliberately plain clinical text (no "Gemini unavailable") since
 * it's shown to the nurse as-is; the fallback is logged on the backend
 * console instead. Like the Gemini prompt, it never names a diagnosis or
 * recommends specific tests, procedures, or treatments.
 */

// Facial asymmetry (Presage face landmarks): flagged for nurse review --
// never treated as a diagnosis -- when the score is at least ABSOLUTE_FLOOR
// and either there's no baseline score or it has risen to at least
// RELATIVE_MULTIPLIER x the patient's own baseline.
// RELATIVE_MULTIPLIER = 2 matches "roughly doubling" in the Gemini prompt.
// ABSOLUTE_FLOOR is a PLACEHOLDER until calibrated against real captures
// (sample scores so far: ~0.003-0.007); it keeps near-zero scores from
// "doubling" on noise.
export const ABSOLUTE_FLOOR = 0.01;
export const RELATIVE_MULTIPLIER = 2;

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

// Missing values (e.g. Presage returned no breathing rate) yield null, not a
// huge fake delta against 0.
function delta(baselineValue, currentValue) {
  return isNumber(baselineValue) && isNumber(currentValue) ? currentValue - baselineValue : null;
}

function describe(label, change, unit) {
  if (change == null) return null;
  const rounded = Math.round(change);
  if (rounded === 0) return `${label} unchanged`;
  return `${label} ${rounded > 0 ? "up" : "down"} ${Math.abs(rounded)} ${unit}`;
}

/** Should this face asymmetry score be flagged for nurse review? Null-safe. */
export function faceAsymmetryFlag(baselineScore, currentScore) {
  if (!isNumber(currentScore) || currentScore < ABSOLUTE_FLOOR) return false;
  if (!isNumber(baselineScore) || baselineScore <= 0) return true; // new asymmetry above the floor
  return currentScore >= baselineScore * RELATIVE_MULTIPLIER;
}

export function fallbackRisk(baseline, current) {
  if (!baseline) {
    return {
      risk_level: "low",
      delta_summary: "No baseline yet.",
      recommended_action: "Awaiting first reading.",
    };
  }

  const hrDelta = delta(baseline.heart_rate, current.heart_rate);
  const rrDelta = delta(baseline.breathing_rate, current.breathing_rate);
  const hr = Math.abs(hrDelta ?? 0);
  const rr = Math.abs(rrDelta ?? 0);

  let risk_level = "low";
  if (hr >= 30 || rr >= 8) {
    risk_level = "high";
  } else if (hr >= 15 || rr >= 4) {
    risk_level = "medium";
  }

  const changes = [describe("HR", hrDelta, "bpm"), describe("RR", rrDelta, "breaths/min")].filter(Boolean);
  let delta_summary = changes.length ? `${changes.join(", ")} since triage.` : "No comparable vitals.";
  let recommended_action = risk_level === "high" ? "Reassess immediately." : "Continue monitoring.";

  if (faceAsymmetryFlag(baseline.face_asymmetry_score, current.face_asymmetry_score)) {
    if (risk_level === "low") risk_level = "medium";
    const from = isNumber(baseline.face_asymmetry_score) ? ` from ${baseline.face_asymmetry_score.toFixed(4)}` : "";
    delta_summary += ` Face asymmetry score rose${from} to ${current.face_asymmetry_score.toFixed(4)} -- flag for nurse review.`;
    recommended_action = `${recommended_action} Check the patient's face in person (the score can also shift with head angle).`;
  }

  return { risk_level, delta_summary, recommended_action };
}
