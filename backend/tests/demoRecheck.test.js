import test, { beforeEach, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";

// Throwaway database + no Gemini -- must be set before the app modules load.
const dbFile = path.join(os.tmpdir(), `er-angel-demo-recheck-test-${process.pid}.db`);
process.env.DATABASE_URL = dbFile;
process.env.GEMINI_ENABLED = "false";
const { db } = await import("../src/db/db.js");
const { seedDemo } = await import("../src/logic/demoSeed.js");
const { runRecheckTick, recheckFields, triggerRecheck, recheckAutoEnabled } = await import("../src/services/recheck.js");
const { recordReading } = await import("../src/services/recordReading.js");
const { pendingCalls } = await import("../src/services/calls.js");

const T0 = new Date("2026-09-26T10:00:00Z");
const min = (m) => new Date(T0.getTime() + m * 60000);

beforeEach(() => {
  delete process.env.RECHECK_TIME_SCALE;
  delete process.env.RECHECK_AUTO;
  db.exec("DELETE FROM calls; DELETE FROM alerts; DELETE FROM readings; DELETE FROM patients; DELETE FROM sqlite_sequence;");
});
after(() => {
  db.close();
  fs.rmSync(dbFile, { force: true });
});

const byName = (name) => db.prepare("SELECT * FROM patients WHERE name = ?").get(name);

async function checkInLive(name, at = T0) {
  const id = db.prepare("INSERT INTO patients (name) VALUES (?)").run(name).lastInsertRowid;
  const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(id);
  await recordReading(patient, { heart_rate: 72, breathing_rate: 14, is_baseline: true }, at);
  return patient;
}

// ---------- seeded (Reset demo) patients ----------

test("is_demo column exists (migration) and every seeded patient is flagged", () => {
  assert.ok(db.prepare("PRAGMA table_info(patients)").all().some((c) => c.name === "is_demo"));
  seedDemo(T0);
  assert.deepStrictEqual(
    db.prepare("SELECT name, is_demo FROM patients ORDER BY id").all(),
    [{ name: "Alex Chen", is_demo: 1 }, { name: "Jordan Smith", is_demo: 1 }, { name: "Sam Rivera", is_demo: 1 }]
  );
});

test("right after a reset: Alex/Jordan count down 15/20 min, Sam is already missed", () => {
  seedDemo(T0);
  assert.deepStrictEqual(recheckFields(byName("Alex Chen").id, T0), {
    next_recheck_at: "2026-09-26 10:15:00", recheck_due: false, missed_recheck: false, recheck_reminders: 0,
  });
  assert.deepStrictEqual(recheckFields(byName("Jordan Smith").id, T0), {
    next_recheck_at: "2026-09-26 10:20:00", recheck_due: false, missed_recheck: false, recheck_reminders: 0,
  });
  const sam = recheckFields(byName("Sam Rivera").id, T0);
  assert.deepStrictEqual([sam.missed_recheck, sam.recheck_reminders], [true, 2]);
  assert.deepStrictEqual(pendingCalls(), [], "Sam's seeded reminders are never announced");
});

test("demo countdowns ignore RECHECK_TIME_SCALE (stay 15/20 min during a pitch)", () => {
  process.env.RECHECK_TIME_SCALE = "0.07";
  seedDemo(T0);
  assert.strictEqual(recheckFields(byName("Alex Chen").id, T0).next_recheck_at, "2026-09-26 10:15:00");
  assert.strictEqual(recheckFields(byName("Sam Rivera").id, T0).missed_recheck, true);
});

test("seeded patients never trigger automatic reminders, however long it runs", () => {
  process.env.RECHECK_TIME_SCALE = "0.07";
  seedDemo(T0);
  for (const m of [1, 5, 16, 21, 60, 180]) assert.deepStrictEqual(runRecheckTick(min(m)), [], `at +${m} min`);
  assert.deepStrictEqual(pendingCalls(), []);
});

test("live kiosk patients still get normal automatic reminders alongside demo patients", async () => {
  seedDemo(T0);
  const live = await checkInLive("Live Patient");
  assert.deepStrictEqual(runRecheckTick(min(29)), []);
  const created = runRecheckTick(min(30));
  assert.deepStrictEqual(created.map((c) => c.patient_id), [live.id]);
});

// ---------- RECHECK_AUTO ----------

test("RECHECK_AUTO: false/0/no/off disables; unset/true enables", () => {
  for (const value of ["false", "FALSE", "0", "no", "off"]) {
    process.env.RECHECK_AUTO = value;
    assert.strictEqual(recheckAutoEnabled(), false, value);
  }
  for (const value of [undefined, "", "true", "1"]) {
    if (value === undefined) delete process.env.RECHECK_AUTO;
    else process.env.RECHECK_AUTO = value;
    assert.strictEqual(recheckAutoEnabled(), true, String(value));
  }
});

test("RECHECK_AUTO=false: no automatic reminders at all, even for a due live patient", async () => {
  process.env.RECHECK_AUTO = "false";
  const live = await checkInLive("Live Patient");
  for (const m of [30, 35, 40, 120]) assert.deepStrictEqual(runRecheckTick(min(m)), []);
  // The card still reports the elapsed interval honestly; it just isn't announced.
  assert.deepStrictEqual([recheckFields(live.id, min(40)).recheck_due, recheckFields(live.id, min(40)).missed_recheck], [true, false]);
});

// ---------- R key (manual trigger) ----------

test("R: triggers a real recheck call now -> announced by the kiosk, card shows Recheck due", () => {
  process.env.RECHECK_AUTO = "false";
  seedDemo(T0);
  const alex = byName("Alex Chen");
  const call = triggerRecheck(alex.id, min(1)); // well before his 15-min interval
  assert.deepStrictEqual(pendingCalls().map((c) => [c.id, c.type, c.patient_id]), [[call.id, "recheck", alex.id]]);
  assert.deepStrictEqual(recheckFields(alex.id, min(1)), {
    next_recheck_at: "2026-09-26 10:15:00", recheck_due: true, missed_recheck: false, recheck_reminders: 1,
  });
});

test("R on a live patient counts like a timed reminder; a rescan clears it", async () => {
  const live = await checkInLive("Live Patient");
  triggerRecheck(live.id, min(2));
  assert.strictEqual(recheckFields(live.id, min(2)).recheck_due, true);
  // Automatic follow-up comes after the normal gap, as for a timed reminder.
  assert.deepStrictEqual(runRecheckTick(min(6)), []);
  assert.strictEqual(runRecheckTick(min(7)).length, 1);

  await recordReading(live, { heart_rate: 72, breathing_rate: 14, is_baseline: false }, min(8));
  const after = recheckFields(live.id, min(8));
  assert.deepStrictEqual([after.recheck_due, after.recheck_reminders], [false, 0]);
  assert.deepStrictEqual(pendingCalls(), []);
});
