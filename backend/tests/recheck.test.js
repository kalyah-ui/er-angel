import test, { beforeEach, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";

// Throwaway database + no Gemini -- must be set before the app modules load.
const dbFile = path.join(os.tmpdir(), `er-angel-recheck-test-${process.pid}.db`);
process.env.DATABASE_URL = dbFile;
process.env.GEMINI_ENABLED = "false";
const { db } = await import("../src/db/db.js");
const { RECHECK_CONFIG, recheckStatus, recheckTimeScale } = await import("../src/logic/recheck.js");
const { runRecheckTick, recheckFields } = await import("../src/services/recheck.js");
const { recordReading, insertAlert } = await import("../src/services/recordReading.js");
const { callToTriage, pendingCalls } = await import("../src/services/calls.js");

const T0 = new Date("2026-09-26T10:00:00Z");
const min = (m) => new Date(T0.getTime() + m * 60000);

beforeEach(() => {
  delete process.env.RECHECK_TIME_SCALE;
  db.exec("DELETE FROM calls; DELETE FROM alerts; DELETE FROM readings; DELETE FROM patients;");
});
after(() => {
  db.close();
  fs.rmSync(dbFile, { force: true });
});

// ---------- pure timing rules ----------

const status = (over) =>
  recheckStatus({ latestReadingAt: T0, riskLevel: null, remindersSince: [], calledToTriage: false, now: T0, scale: 1, ...over });

test("interval by latest risk: high 15, medium 20, low/no alert 30 minutes", () => {
  assert.deepStrictEqual(RECHECK_CONFIG.intervalMinutes, { high: 15, medium: 20, low: 30 });
  assert.deepStrictEqual(status({ riskLevel: "high" }).next_recheck_at, min(15));
  assert.deepStrictEqual(status({ riskLevel: "medium" }).next_recheck_at, min(20));
  assert.deepStrictEqual(status({ riskLevel: "low" }).next_recheck_at, min(30));
  assert.deepStrictEqual(status({ riskLevel: null }).next_recheck_at, min(30));
});

test("due exactly when the latest reading is older than the interval", () => {
  assert.deepStrictEqual([status({ riskLevel: "high", now: min(14.9) }).recheck_due, status({ riskLevel: "high", now: min(14.9) }).remind], [false, false]);
  assert.deepStrictEqual([status({ riskLevel: "high", now: min(15) }).recheck_due, status({ riskLevel: "high", now: min(15) }).remind], [true, true]);
});

test("second reminder after a 5-minute gap, then missed after 2 unanswered reminders", () => {
  const r1 = [min(30)];
  assert.strictEqual(status({ remindersSince: r1, now: min(34.9) }).remind, false);
  assert.strictEqual(status({ remindersSince: r1, now: min(35) }).remind, true);
  assert.strictEqual(status({ remindersSince: r1, now: min(35) }).missed_recheck, false);

  const r2 = [min(30), min(35)];
  assert.deepStrictEqual(
    (({ remind, missed_recheck }) => ({ remind, missed_recheck }))(status({ remindersSince: r2, now: min(39) })),
    { remind: false, missed_recheck: false }
  );
  const later = status({ remindersSince: r2, now: min(40) });
  assert.deepStrictEqual({ remind: later.remind, missed: later.missed_recheck, due: later.recheck_due }, { remind: false, missed: true, due: true });
});

test("RECHECK_TIME_SCALE scales every duration (interval and reminder gap)", () => {
  const s = (over) => status({ scale: 0.1, ...over });
  assert.deepStrictEqual(s({ riskLevel: "high" }).next_recheck_at, min(1.5));
  assert.strictEqual(s({ remindersSince: [min(3)], now: min(3.5) }).remind, true); // 5 min * 0.1 = 30s

  process.env.RECHECK_TIME_SCALE = "0.07";
  assert.strictEqual(recheckTimeScale(), 0.07);
  for (const bad of ["abc", "0", "-1"]) {
    process.env.RECHECK_TIME_SCALE = bad;
    assert.strictEqual(recheckTimeScale(), 1, bad);
  }
  delete process.env.RECHECK_TIME_SCALE;
  assert.strictEqual(recheckTimeScale(), 1);
});

test("no reminders before a first reading, or once called to triage", () => {
  assert.strictEqual(status({ latestReadingAt: null, now: min(99) }).remind, false);
  const called = status({ calledToTriage: true, now: min(99) });
  assert.deepStrictEqual([called.remind, called.recheck_due, called.next_recheck_at], [false, false, null]);
});

// ---------- scheduler against the database ----------

async function checkIn(name, at = T0) {
  const id = db.prepare("INSERT INTO patients (name, created_at) VALUES (?, ?)").run(name, "2026-09-26 10:00:00").lastInsertRowid;
  const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(id);
  await recordReading(patient, { heart_rate: 72, breathing_rate: 14, is_baseline: true }, at);
  return patient;
}

const recheckCalls = (patientId) =>
  db.prepare("SELECT * FROM calls WHERE patient_id = ? AND type = 'recheck' ORDER BY id").all(patientId);

test("full cycle: due -> reminder -> reminder 2 -> missed -> rescan clears it", async () => {
  const p = await checkIn("Low risk");

  assert.deepStrictEqual(runRecheckTick(min(29)), []);
  assert.strictEqual(runRecheckTick(min(30)).length, 1);
  assert.deepStrictEqual(runRecheckTick(min(31)), [], "no duplicate while waiting for the gap");
  assert.deepStrictEqual(recheckFields(p.id, min(31)), {
    next_recheck_at: "2026-09-26 10:30:00", recheck_due: true, missed_recheck: false, recheck_reminders: 1,
  });

  assert.strictEqual(runRecheckTick(min(35)).length, 1);
  assert.deepStrictEqual(runRecheckTick(min(40)), [], "never a third reminder");
  assert.strictEqual(recheckFields(p.id, min(40)).missed_recheck, true);
  assert.strictEqual(recheckCalls(p.id).length, 2);

  // Rescan at 41 min (low risk): timer restarts from the new reading (+30 min), missed clears.
  await recordReading(p, { heart_rate: 74, breathing_rate: 14, is_baseline: false }, min(41));
  const after = recheckFields(p.id, min(41));
  assert.deepStrictEqual(after, { next_recheck_at: "2026-09-26 11:11:00", recheck_due: false, missed_recheck: false, recheck_reminders: 0 });
});

test("new reading drops a reminder that is still waiting to be announced", async () => {
  const p = await checkIn("Pending");
  runRecheckTick(min(30));
  assert.deepStrictEqual(pendingCalls().map((c) => c.type), ["recheck"]);
  await recordReading(p, { heart_rate: 72, breathing_rate: 14, is_baseline: false }, min(31));
  assert.deepStrictEqual(pendingCalls(), []);
});

test("interval follows the latest alert's risk level", async () => {
  const p = await checkIn("High risk");
  const reading = db.prepare("SELECT id FROM readings WHERE patient_id = ?").get(p.id);
  insertAlert(p.id, reading.id, { risk_level: "high", delta_summary: "", reason_text: "", recommended_action: "" });
  assert.deepStrictEqual(runRecheckTick(min(14)), []);
  assert.strictEqual(runRecheckTick(min(15)).length, 1);
});

test("patients called to the triage desk get no recheck reminders", async () => {
  const p = await checkIn("Called");
  callToTriage(p.id, min(10));
  assert.deepStrictEqual(runRecheckTick(min(60)), []);
  assert.strictEqual(recheckFields(p.id, min(60)).next_recheck_at, null);
});

test("RECHECK_TIME_SCALE applies to the scheduler", async () => {
  process.env.RECHECK_TIME_SCALE = "0.1";
  await checkIn("Scaled"); // low risk: 30 min * 0.1 = 3 min
  assert.deepStrictEqual(runRecheckTick(min(2.9)), []);
  assert.strictEqual(runRecheckTick(min(3)).length, 1);
});
