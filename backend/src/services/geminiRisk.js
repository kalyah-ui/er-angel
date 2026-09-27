import { callGemini, geminiDisabledReason } from "./geminiClient.js";
import { fallbackRisk } from "../logic/riskThresholds.js";

const RISK_LEVELS = ["low", "medium", "high"];

const SYSTEM_PROMPT = `You are a clinical triage support assistant helping an
ER waiting room monitor patients between nurse checks. Compare a patient's
baseline vitals to their current vitals and chief complaint. Respond ONLY
with minified JSON, no markdown fences, no prose, matching exactly this
shape:
{"risk_level": "low" | "medium" | "high", "delta_summary": string, "recommended_action": string}

Do not attempt to diagnose a condition. Describe the magnitude and direction
of change and its urgency only.

SIGNAL PRIORITY -- inputs are not all equally reliable, and one is handled
as its own category:

1. FACIAL ASYMMETRY (face_asymmetry_score) -- possible stroke screening
   signal, evaluated separately from the rest:
   - A clear, substantial increase from baseline (roughly doubling or more,
     especially alongside a complaint like dizziness, weakness, numbness,
     or vision/speech changes) should push risk_level to "high" on its own,
     regardless of what HR/RR are doing. Facial droop is time-critical --
     don't wait for other signals to corroborate it.
   - However, this measurement can also shift simply because the patient's
     head angle relative to the camera changed between readings, not
     because of any real facial change -- it has no correction for this
     yet. So when face_asymmetry drives the escalation, say so explicitly
     in delta_summary (e.g. "face asymmetry score rose from X to Y --
     possible facial droop, recommend visual confirmation") and make
     recommended_action a specific instruction to visually check the
     patient's face for droop in person before treating this as confirmed,
     rather than a generic "reassess."

2. HEART RATE (HR) and BREATHING RATE (RR) -- primary, most reliable
   signals for everything else. Base risk_level mainly on their magnitude
   and direction of change, combined with the chief complaint.

3. STRESS (EDA) -- secondary, lower-confidence signal. It may corroborate
   or add urgency to a change already indicated by HR/RR, but should NOT
   independently push risk_level to "medium" or "high" when HR and RR are
   stable or improving and facial asymmetry hasn't fired. Always describe
   EDA changes in absolute terms (e.g. "EDA rose by 0.02"), never as a
   percentage -- EDA baselines are often near zero, so percentage changes
   are exaggerated and misleading here, unlike HR/RR where percentages are
   fine.

Err toward "medium" or "high" if the primary signals (HR, RR, chief
complaint) or a facial asymmetry increase leave genuine clinical
uncertainty -- this is a screening aid, not a replacement for clinical
judgment. Do not apply that same bias toward escalation on the strength of
EDA alone.`;

/**
 * @param {object} params
 * @param {object|null} params.baseline  { heart_rate, breathing_rate, stress_score }
 * @param {object} params.current        { heart_rate, breathing_rate, stress_score }
 * @param {string} params.chiefComplaint
 * @param {number} params.minutesElapsed
 */
export async function classifyRisk({ baseline, current, chiefComplaint, minutesElapsed }) {
  const disabled = geminiDisabledReason();
  if (disabled) {
    console.warn(`[geminiRisk] FALLBACK: ${disabled} -- using rule-based thresholds`);
    return fallbackRisk(baseline, current);
  }

  const prompt = JSON.stringify({
    baseline,
    current,
    chief_complaint: chiefComplaint,
    minutes_elapsed: minutesElapsed,
  });

  try {
    return await callGemini(
      "geminiRisk",
      { systemInstruction: SYSTEM_PROMPT, generationConfig: { responseMimeType: "application/json" } },
      async (model) => {
        const result = await model.generateContent(prompt);
        // A malformed response throws here, which counts as a retryable failure.
        const parsed = JSON.parse(result.response.text());
        const risk_level = String(parsed.risk_level ?? "").toLowerCase();
        if (!RISK_LEVELS.includes(risk_level)) throw new Error("Malformed Gemini response");
        return { ...parsed, risk_level };
      }
    );
  } catch (err) {
    console.error(`[geminiRisk] FALLBACK: all Gemini attempts failed (${err.message}) -- using rule-based thresholds`);
    return fallbackRisk(baseline, current);
  }
}
