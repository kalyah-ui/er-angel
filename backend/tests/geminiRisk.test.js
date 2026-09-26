import test from "node:test";
import assert from "node:assert";
import { fallbackRisk } from "../src/logic/riskThresholds.js";
import { evaluateEdaAlert } from "../src/logic/edaAlert.js";

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

test("EDA alert triggers at 50 percent above the rolling baseline", () => {
  const result = evaluateEdaAlert({
    current: { stress_score: 0.15 },
    history: [{ stress_score: 0.1 }],
  });
  assert.strictEqual(result.aboveBaseline, true);
  assert.strictEqual(result.triggered, true);
});

test("EDA alert triggers after three consecutive increases", () => {
  const result = evaluateEdaAlert({
    current: { stress_score: 0.14 },
    history: [
      { stress_score: 0.1 },
      { stress_score: 0.11 },
      { stress_score: 0.12 },
    ],
  });
  assert.strictEqual(result.risingForThreeCheckins, true);
  assert.strictEqual(result.triggered, true);
});

test("a missing EDA check-in breaks the consecutive-rise streak", () => {
  const result = evaluateEdaAlert({
    current: { stress_score: 0.14 },
    history: [
      { stress_score: 0.1 },
      { stress_score: null },
      { stress_score: 0.12 },
    ],
  });
  assert.strictEqual(result.risingForThreeCheckins, false);
});

test("increasing heart rate or breathing rate marks an EDA alert for escalation", () => {
  const result = evaluateEdaAlert({
    current: { stress_score: 0.16, heart_rate: 82, breathing_rate: 17 },
    history: [{ stress_score: 0.1, heart_rate: 80, breathing_rate: 16 }],
  });
  assert.strictEqual(result.accompanyingVitalsIncreasing, true);
  assert.strictEqual(result.heartRateIncreasing, true);
  assert.strictEqual(result.breathingRateIncreasing, true);
});
