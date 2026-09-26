import { GoogleGenerativeAI } from "@google/generative-ai";
import { fallbackRisk } from "../logic/riskThresholds.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

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
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[geminiRisk] no API key set, using fallback logic");
    return fallbackRisk(baseline, current);
  }

  try {
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: { responseMimeType: "application/json" },
    });

    const prompt = JSON.stringify({
      baseline,
      current,
      chief_complaint: chiefComplaint,
      minutes_elapsed: minutesElapsed,
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);

    if (!parsed.risk_level) throw new Error("Malformed Gemini response");
    return parsed;
  } catch (err) {
    console.error("[geminiRisk] falling back to rule-based logic:", err.message);
    return fallbackRisk(baseline, current);
  }
}
