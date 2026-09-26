/**
 * Fallback risk classification used ONLY if every Gemini attempt fails or
 * times out. Never let the demo show a blank/broken state -- always fall
 * back to something defensible. The wording is deliberately plain clinical
 * text (no "Gemini unavailable") since it's shown to the nurse as-is; the
 * fallback is logged on the backend console instead.
 */

// Missing values (e.g. Presage returned no breathing rate) yield null, not a
// huge fake delta against 0.
function delta(baselineValue, currentValue) {
  return typeof baselineValue === "number" && typeof currentValue === "number"
    ? currentValue - baselineValue
    : null;
}

function describe(label, change, unit) {
  if (change == null) return null;
  const rounded = Math.round(change);
  if (rounded === 0) return `${label} unchanged`;
  return `${label} ${rounded > 0 ? "up" : "down"} ${Math.abs(rounded)} ${unit}`;
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

  return {
    risk_level,
    delta_summary: changes.length ? `${changes.join(", ")} since triage.` : "No comparable vitals.",
    recommended_action: risk_level === "high" ? "Reassess immediately." : "Continue monitoring.",
  };
}
