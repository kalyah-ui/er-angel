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
