import test from "node:test";
import assert from "node:assert";
import { fallbackRisk } from "../src/logic/riskThresholds.js";

test("fallbackRisk flags a large HR jump as high risk", () => {
  const baseline = { heart_rate: 72, breathing_rate: 14 };
  const current = { heart_rate: 110, breathing_rate: 15 };
  const result = fallbackRisk(baseline, current);
  assert.strictEqual(result.risk_level, "high");
});

test("fallbackRisk treats small changes as low risk", () => {
  const baseline = { heart_rate: 72, breathing_rate: 14 };
  const current = { heart_rate: 75, breathing_rate: 15 };
  const result = fallbackRisk(baseline, current);
  assert.strictEqual(result.risk_level, "low");
});

test("fallbackRisk handles missing baseline", () => {
  const result = fallbackRisk(null, { heart_rate: 80 });
  assert.strictEqual(result.risk_level, "low");
});

test("fallbackRisk ignores a missing breathing rate instead of treating it as 0", () => {
  const baseline = { heart_rate: 72, breathing_rate: 14 };
  const current = { heart_rate: 74, breathing_rate: null };
  const result = fallbackRisk(baseline, current);
  assert.strictEqual(result.risk_level, "low");
  assert.strictEqual(result.delta_summary, "HR up 2 bpm since triage.");
});

test("fallbackRisk text never mentions Gemini", () => {
  const result = fallbackRisk({ heart_rate: 72, breathing_rate: 14 }, { heart_rate: 110, breathing_rate: 15 });
  assert.strictEqual(result.delta_summary, "HR up 38 bpm, RR up 1 breaths/min since triage.");
  assert.doesNotMatch(result.delta_summary + result.recommended_action, /gemini|fallback|unavailable/i);
});
