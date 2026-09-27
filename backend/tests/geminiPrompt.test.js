import test, { after } from "node:test";
import assert from "node:assert";
import { classifyRisk } from "../src/services/geminiRisk.js";
import { generateAlertLine } from "../src/services/geminiAlertText.js";
import { EDA_ESCALATION } from "../src/logic/edaAlert.js";
import { ABSOLUTE_FLOOR, RELATIVE_MULTIPLIER, faceAsymmetryFlag } from "../src/logic/riskThresholds.js";

// Capture what would be sent to Gemini (stubbed fetch; nothing leaves the machine).
const realFetch = globalThis.fetch;
let sent = [];
globalThis.fetch = async (url, options) => {
  sent.push(JSON.parse(options.body));
  const text = JSON.stringify({ risk_level: "low", delta_summary: "Stable.", recommended_action: "Continue monitoring." });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
process.env.GEMINI_API_KEY = "fake-key";
process.env.GEMINI_ENABLED = "true";
after(() => {
  globalThis.fetch = realFetch;
});

const systemText = (body) => body.systemInstruction.parts.map((p) => p.text).join(" ");
const userText = (body) => body.contents.at(-1).parts.map((p) => p.text).join(" ");

test("face_asymmetry_score (and null values) reach Gemini", async () => {
  sent = [];
  await classifyRisk({
    baseline: { heart_rate: 72, breathing_rate: 14, stress_score: 0.026, face_asymmetry_score: 0.005 },
    current: { heart_rate: 74, breathing_rate: 14, stress_score: null, face_asymmetry_score: 0.012 },
    chiefComplaint: "Dizzy",
    minutesElapsed: 20,
  });
  const payload = JSON.parse(userText(sent[0]));
  assert.strictEqual(payload.baseline.face_asymmetry_score, 0.005);
  assert.strictEqual(payload.current.face_asymmetry_score, 0.012);
  assert.strictEqual(payload.current.stress_score, null);
});

test("risk prompt: no diagnosis, no specific tests/procedures/treatments, face asymmetry = nurse review", async () => {
  sent = [];
  await classifyRisk({ baseline: { heart_rate: 72 }, current: { heart_rate: 74 }, chiefComplaint: "", minutesElapsed: 1 });
  const prompt = systemText(sent[0]);
  assert.match(prompt, /Do not recommend\s+specific tests, procedures, or treatments; describe changes and urgency only\s+\(e\.g\. reassess, escalate to physician\)\./);
  assert.match(prompt, /never name one/);
  assert.match(prompt, /flag it for nurse review/);
  assert.doesNotMatch(prompt, /stroke|droop/i);
});

test("alert-line prompt carries the same restriction", async () => {
  sent = [];
  await generateAlertLine({ risk_level: "low", delta_summary: "Stable.", recommended_action: "Continue monitoring." }, "Patient 1");
  assert.match(systemText(sent[0]), /Never name a\s+diagnosis or recommend specific tests, procedures, or treatments/);
});

test("thresholds live in one config spot each", () => {
  assert.deepStrictEqual(EDA_ESCALATION, { minHeartRateRise: 10, minBreathingRateRise: 4 });
  assert.deepStrictEqual([ABSOLUTE_FLOOR, RELATIVE_MULTIPLIER], [0.01, 2]);
  assert.strictEqual(faceAsymmetryFlag(0.005, 0.01), true); // exactly floor and exactly 2x
  assert.strictEqual(faceAsymmetryFlag(null, 0.02), true); // new, above the floor
  assert.strictEqual(faceAsymmetryFlag(0.005, undefined), false);
});
