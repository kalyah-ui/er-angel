import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const SYSTEM_PROMPT = `Turn a clinical risk assessment into ONE short,
plain-English line a busy ER nurse can scan in under 2 seconds. Style
example: "Patient 4: HR up 35 bpm since triage, reassess." Do not use
markdown, quotes, or a preamble -- output only the single line.`;

/**
 * @param {object} riskJson  output of classifyRisk()
 * @param {string} patientLabel  e.g. "Patient 4"
 */
export async function generateAlertLine(riskJson, patientLabel) {
  const fallbackLine = `${patientLabel}: ${riskJson.delta_summary} (${riskJson.risk_level} risk)`;

  if (!process.env.GEMINI_API_KEY) return fallbackLine;

  try {
    const model = genAI.getGenerativeModel({ model: MODEL, systemInstruction: SYSTEM_PROMPT });
    const prompt = `Patient label: ${patientLabel}\nRisk assessment: ${JSON.stringify(riskJson)}`;
    const result = await model.generateContent(prompt);
    const line = result.response.text().trim();
    return line || fallbackLine;
  } catch (err) {
    console.error("[geminiAlertText] falling back to templated line:", err.message);
    return fallbackLine;
  }
}
