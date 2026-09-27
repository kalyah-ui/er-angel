import { callGemini, geminiDisabledReason } from "./geminiClient.js";

const SYSTEM_PROMPT = `Turn a clinical risk assessment into ONE short,
plain-English line a busy ER nurse can scan in under 2 seconds. Style
example: "Patient 4: HR up 35 bpm since triage, reassess." Never name a
diagnosis or recommend specific tests, procedures, or treatments; describe
changes and urgency only (e.g. reassess, escalate to physician). Do not use
markdown, quotes, or a preamble -- output only the single line.`;

/**
 * @param {object} riskJson  output of classifyRisk()
 * @param {string} patientLabel  e.g. "Patient 4"
 */
export async function generateAlertLine(riskJson, patientLabel) {
  const fallbackLine = `${patientLabel}: ${riskJson.delta_summary}`;

  const disabled = geminiDisabledReason();
  if (disabled) {
    console.warn(`[geminiAlertText] FALLBACK: ${disabled} -- using templated line`);
    return fallbackLine;
  }

  try {
    const prompt = `Patient label: ${patientLabel}\nRisk assessment: ${JSON.stringify(riskJson)}`;
    return await callGemini("geminiAlertText", { systemInstruction: SYSTEM_PROMPT }, async (model) => {
      const result = await model.generateContent(prompt);
      const line = result.response.text().trim();
      if (!line) throw new Error("Empty Gemini response");
      return line;
    });
  } catch (err) {
    console.error(`[geminiAlertText] FALLBACK: all Gemini attempts failed (${err.message}) -- using templated line`);
    return fallbackLine;
  }
}
