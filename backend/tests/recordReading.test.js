import test, { beforeEach, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";

// Throwaway database + no Gemini -- must be set before the app modules load.
const dbFile = path.join(os.tmpdir(), `er-angel-reading-test-${process.pid}.db`);
process.env.DATABASE_URL = dbFile;
process.env.GEMINI_ENABLED = "false";
const { db } = await import("../src/db/db.js");
const { recordReading } = await import("../src/services/recordReading.js");

const T0 = new Date("2026-09-26T10:00:00Z");
const min = (m) => new Date(T0.getTime() + m * 60000);

beforeEach(() => db.exec("DELETE FROM calls; DELETE FROM alerts; DELETE FROM readings; DELETE FROM patients;"));
after(() => {
  db.close();
  fs.rmSync(dbFile, { force: true });
});

function addPatient() {
  const id = db.prepare("INSERT INTO patients (name) VALUES ('Test')").run().lastInsertRowid;
  return db.prepare("SELECT * FROM patients WHERE id = ?").get(id);
}

test("stores face_asymmetry_score and unrounded EDA (stress_score) from Presage", async () => {
  const p = addPatient();
  const { reading } = await recordReading(
    p,
    { heart_rate: 72, breathing_rate: 14, stress_score: 0.039, face_asymmetry_score: 0.007, is_baseline: true },
    T0
  );
  assert.deepStrictEqual([reading.stress_score, reading.face_asymmetry_score], [0.039, 0.007]);
});

test("EDA 50% above its rolling baseline, with rising HR/RR, escalates a rescan to high", async () => {
  const p = addPatient();
  await recordReading(p, { heart_rate: 76, breathing_rate: 20, stress_score: 0.026, is_baseline: true }, T0);
  // Same shape as main's test_output.json sample: small HR/RR rise, EDA +50%.
  const { alert } = await recordReading(p, { heart_rate: 80, breathing_rate: 21, stress_score: 0.039, is_baseline: false }, min(5));
  assert.strictEqual(alert.risk_level, "high"); // rule-based alone would say low
  assert.match(alert.delta_summary, /EDA alert: EDA is 50% above its rolling baseline, with increasing heart rate and breathing rate\.$/);
  assert.strictEqual(alert.reason_text, `Patient ${p.id}: ${alert.delta_summary}`);
  assert.strictEqual(alert.recommended_action, "Prompt nurse reassessment due to concurrent EDA and vital-sign increases.");
});

test("EDA spike without rising HR/RR is escalated to medium only", async () => {
  const p = addPatient();
  await recordReading(p, { heart_rate: 76, breathing_rate: 16, stress_score: 0.1, is_baseline: true }, T0);
  const { alert } = await recordReading(p, { heart_rate: 75, breathing_rate: 16, stress_score: 0.2, is_baseline: false }, min(5));
  assert.strictEqual(alert.risk_level, "medium");
  assert.strictEqual(alert.recommended_action, "Nurse review recommended; repeat vitals and assess the patient.");
});

test("no EDA data (e.g. mock vitals, D/M overrides): normal alert, no EDA text", async () => {
  const p = addPatient();
  await recordReading(p, { heart_rate: 72, breathing_rate: 14, stress_score: null, is_baseline: true }, T0);
  const { alert } = await recordReading(p, { heart_rate: 107, breathing_rate: 19, stress_score: null, is_baseline: false }, min(5));
  assert.strictEqual(alert.risk_level, "high");
  assert.doesNotMatch(alert.delta_summary, /EDA/);
});
