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
of change and its urgency only. Err toward "medium" or "high" if uncertain --
this is a screening aid, not a replacement for clinical judgment.`;

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
