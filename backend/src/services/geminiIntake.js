import { callGemini, hasGeminiKey } from "./geminiClient.js";

const SYSTEM_PROMPT = `You are a friendly ER check-in assistant. Ask the
patient 2-3 short questions about their symptoms (e.g. pain, dizziness,
shortness of breath, duration). After the exchange, respond ONLY with JSON:
{"chief_complaint": string, "initial_severity_hint": "low"|"medium"|"high"}
Do not diagnose. Keep questions brief and non-alarming.`;

/**
 * STRETCH GOAL -- only build this if the core baseline/rescan/alert loop
 * is working end to end. Simple single-turn version for hackathon speed;
 * extend to multi-turn chat history if time allows.
 */
export async function runIntakeTurn(conversationHistory) {
  if (!hasGeminiKey()) {
    return { reply: "What brought you in today?", done: false };
  }

  const text = await callGemini("geminiIntake", { systemInstruction: SYSTEM_PROMPT }, async (model) => {
    const chat = model.startChat({ history: conversationHistory });
    const result = await chat.sendMessage(conversationHistory.at(-1)?.parts?.[0]?.text || "Hello");
    return result.response.text();
  });

  try {
    const parsed = JSON.parse(text);
    return { done: true, ...parsed };
  } catch {
    return { reply: text, done: false };
  }
}
