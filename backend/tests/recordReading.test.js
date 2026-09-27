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

// EDA rule: EDA escalates only to "medium", and only when HR rose >= 10 bpm
// or RR rose >= 4 breaths/min since triage (EDA_ESCALATION).
async function rescanAfter(baseline, rescan) {
  const p = addPatient();
  await recordReading(p, { ...baseline, is_baseline: true }, T0);
  const { alert } = await recordReading(p, { ...rescan, is_baseline: false }, min(5));
  return { p, alert };
}

test("EDA spike + HR up >= 10 bpm escalates a low rescan to medium (never high)", async () => {
  const { p, alert } = await rescanAfter(
    { heart_rate: 76, breathing_rate: 16, stress_score: 0.026 },
    { heart_rate: 88, breathing_rate: 16, stress_score: 0.039 } // rule-based alone: HR +12 -> low
  );
  assert.strictEqual(alert.risk_level, "medium");
  assert.match(alert.delta_summary, /EDA alert: EDA 0\.039 vs rolling baseline 0\.026, with HR up 12 bpm since triage\.$/);
  assert.strictEqual(alert.reason_text, `Patient ${p.id}: ${alert.delta_summary}`);
  assert.strictEqual(alert.recommended_action, "Reassess the patient: EDA and vital signs are rising together.");
});

test("EDA spike + RR up exactly 4 escalates (threshold is inclusive)", async () => {
  const { alert } = await rescanAfter(
    { heart_rate: 76, breathing_rate: 16, stress_score: 0.026 },
    { heart_rate: 76, breathing_rate: 20, stress_score: 0.039 }
  );
  assert.strictEqual(alert.risk_level, "medium");
  assert.match(alert.delta_summary, /with RR up 4 breaths\/min since triage\.$/);
});

for (const [hr, rr, label] of [
  [85, 19, "HR +9, RR +3 (just under both thresholds)"],
  [85.9, 19.9, "HR +9.9, RR +3.9"],
  [80, 17, "HR +4, RR +1 (main's test_output.json sample)"],
  [76, 16, "vitals unchanged"],
]) {
  test(`EDA spike with jitter below the thresholds never escalates: ${label}`, async () => {
    const { alert } = await rescanAfter(
      { heart_rate: 76, breathing_rate: 16, stress_score: 0.026 },
      { heart_rate: hr, breathing_rate: rr, stress_score: 0.039 }
    );
    assert.strictEqual(alert.risk_level, "low");
    assert.doesNotMatch(alert.delta_summary, /EDA/);
    assert.strictEqual(alert.recommended_action, "Continue monitoring.");
  });
}

test("EDA never lowers a risk already high from the vitals", async () => {
  const { alert } = await rescanAfter(
    { heart_rate: 72, breathing_rate: 14, stress_score: 0.026 },
    { heart_rate: 112, breathing_rate: 14, stress_score: 0.039 } // HR +40 -> high
  );
  assert.strictEqual(alert.risk_level, "high");
  assert.match(alert.delta_summary, /EDA alert/);
});

test("null EDA on either reading never triggers the EDA rule", async () => {
  for (const [base, cur] of [[null, 0.039], [0.026, null]]) {
    const { alert } = await rescanAfter(
      { heart_rate: 76, breathing_rate: 16, stress_score: base },
      { heart_rate: 90, breathing_rate: 16, stress_score: cur }
    );
    assert.doesNotMatch(alert.delta_summary, /EDA/);
  }
});

// ---------- facial asymmetry: flag for nurse review, never a diagnosis ----------

test("face asymmetry doubling above the floor is flagged for nurse review (medium)", async () => {
  const { alert } = await rescanAfter(
    { heart_rate: 76, breathing_rate: 16, face_asymmetry_score: 0.005 },
    { heart_rate: 76, breathing_rate: 16, face_asymmetry_score: 0.012 }
  );
  assert.strictEqual(alert.risk_level, "medium");
  assert.match(alert.delta_summary, /Face asymmetry score rose from 0\.0050 to 0\.0120 -- flag for nurse review\./);
  assert.match(alert.recommended_action, /Check the patient's face in person/);
  assert.doesNotMatch(`${alert.delta_summary} ${alert.recommended_action}`, /stroke|droop|palsy/i);
});

test("face asymmetry: no flag below the floor, below 2x, or when missing", async () => {
  for (const [base, cur] of [
    [0.004, 0.009], // doubled, but under ABSOLUTE_FLOOR
    [0.008, 0.012], // above the floor, but only 1.5x
    [0.005, null], // not measured
    [null, null],
  ]) {
    const { alert } = await rescanAfter(
      { heart_rate: 76, breathing_rate: 16, face_asymmetry_score: base },
      { heart_rate: 76, breathing_rate: 16, face_asymmetry_score: cur }
    );
    assert.strictEqual(alert.risk_level, "low", `${base} -> ${cur}`);
    assert.doesNotMatch(alert.delta_summary, /asymmetry/i, `${base} -> ${cur}`);
  }
});

test("no EDA data (e.g. mock vitals, D/M overrides): normal alert, no EDA text", async () => {
  const p = addPatient();
  await recordReading(p, { heart_rate: 72, breathing_rate: 14, stress_score: null, is_baseline: true }, T0);
  const { alert } = await recordReading(p, { heart_rate: 107, breathing_rate: 19, stress_score: null, is_baseline: false }, min(5));
  assert.strictEqual(alert.risk_level, "high");
  assert.doesNotMatch(alert.delta_summary, /EDA/);
});
