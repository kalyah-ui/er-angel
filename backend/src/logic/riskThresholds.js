/**
 * Fallback risk classification used ONLY if the Gemini call fails or times
 * out. Never let the demo show a blank/broken state -- always fall back to
 * something defensible.
 */
export function fallbackRisk(baseline, current) {
  if (!baseline) {
    return {
      risk_level: "low",
      delta_summary: "No baseline yet.",
      recommended_action: "Awaiting first reading.",
    };
  }

  const hrDelta = (current.heart_rate ?? 0) - (baseline.heart_rate ?? 0);
  const rrDelta = (current.breathing_rate ?? 0) - (baseline.breathing_rate ?? 0);

  let risk_level = "low";
  if (Math.abs(hrDelta) >= 30 || Math.abs(rrDelta) >= 8) {
    risk_level = "high";
  } else if (Math.abs(hrDelta) >= 15 || Math.abs(rrDelta) >= 4) {
    risk_level = "medium";
  }

  return {
    risk_level,
    delta_summary: `HR change: ${hrDelta.toFixed(0)} bpm, RR change: ${rrDelta.toFixed(0)} breaths/min (rule-based fallback, Gemini unavailable).`,
    recommended_action: risk_level === "high" ? "Reassess immediately." : "Continue monitoring.",
  };
}
