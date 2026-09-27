import { callGemini, geminiDisabledReason } from "./geminiClient.js";
import { fallbackRisk } from "../logic/riskThresholds.js";

const RISK_LEVELS = ["low", "medium", "high"];

const SYSTEM_PROMPT = `You are a clinical triage support assistant helping an
ER waiting room monitor patients between nurse checks. Compare a patient's
baseline vitals to their current vitals and chief complaint. Respond ONLY
with minified JSON, no markdown fences, no prose, matching exactly this
shape:
{"risk_level": "low" | "medium" | "high", "delta_summary": string, "recommended_action": string}

Do not attempt to diagnose a condition, and never name one. Do not recommend
specific tests, procedures, or treatments; describe changes and urgency only
(e.g. reassess, escalate to physician). Describe the magnitude and direction
of change and its urgency only.

Any input may be null, meaning it wasn't measured. Ignore nulls -- never
treat a missing value as a change.

SIGNAL PRIORITY -- inputs are not all equally reliable, and one is handled
as its own category:

1. FACIAL ASYMMETRY (face_asymmetry_score) -- a supplementary screening
   cue for the nurse, never a diagnosis:
   - If it is new or has clearly increased from baseline (roughly doubling
     or more), flag it for nurse review: raise risk_level to at least
     "medium" (higher only if HR, RR, or the chief complaint also warrant
     it).
   - The score can also shift simply because the patient's head angle
     relative to the camera changed between readings -- it has no
     correction for this yet. So say so plainly in delta_summary (e.g.
     "face asymmetry score rose from X to Y -- flag for nurse review") and
     make recommended_action an instruction for the nurse to check the
     patient's face in person. Do not name or suggest any condition.

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
