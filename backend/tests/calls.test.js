import test, { beforeEach, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";

// Throwaway database -- must be set before db.js is imported.
const dbFile = path.join(os.tmpdir(), `er-angel-calls-test-${process.pid}.db`);
process.env.DATABASE_URL = dbFile;
const { db } = await import("../src/db/db.js");
const calls = await import("../src/services/calls.js");

const at = (iso) => new Date(`${iso}Z`);

function addPatient(name = "Test") {
  return db.prepare("INSERT INTO patients (name) VALUES (?)").run(name).lastInsertRowid;
}

beforeEach(() => db.exec("DELETE FROM calls; DELETE FROM readings; DELETE FROM alerts; DELETE FROM patients;"));
after(() => {
  db.close();
  fs.rmSync(dbFile, { force: true });
});

test("a triage call is pending until the kiosk marks it announced", () => {
  const p = addPatient();
  const call = calls.callToTriage(p, at("2026-09-26T10:00:00"));
  assert.deepStrictEqual(
    { patient_id: call.patient_id, type: call.type, announced: call.announced, created_at: call.created_at },
    { patient_id: p, type: "triage", announced: 0, created_at: "2026-09-26 10:00:00" }
  );
  assert.deepStrictEqual(calls.pendingCalls().map((c) => c.id), [call.id]);

  assert.strictEqual(calls.markAnnounced(call.id).announced, 1);
  assert.deepStrictEqual(calls.pendingCalls(), []);
  assert.strictEqual(calls.markAnnounced(9999), null);
});

test("pending calls: triage before recheck, then oldest first; no patient names", () => {
  const a = addPatient("Alice");
  const b = addPatient("Bob");
  const r1 = calls.createCall(a, "recheck", at("2026-09-26T10:00:00"));
  const t2 = calls.createCall(b, "triage", at("2026-09-26T10:05:00"));
  const t1 = calls.createCall(a, "triage", at("2026-09-26T10:01:00"));
  const pending = calls.pendingCalls();
  assert.deepStrictEqual(pending.map((c) => c.id), [t1.id, t2.id, r1.id]);
  assert.ok(pending.every((c) => !("name" in c)));
});

test("calling a patient to triage drops their queued recheck reminder", () => {
  const p = addPatient();
  calls.createCall(p, "recheck", at("2026-09-26T10:00:00"));
  calls.callToTriage(p, at("2026-09-26T10:02:00"));
  assert.deepStrictEqual(calls.pendingCalls().map((c) => c.type), ["triage"]);
});

test("lastTriageCallAt returns the latest triage call only", () => {
  const p = addPatient();
  assert.strictEqual(calls.lastTriageCallAt(p), null);
  calls.callToTriage(p, at("2026-09-26T10:00:00"));
  calls.callToTriage(p, at("2026-09-26T10:07:00"));
  calls.createCall(p, "recheck", at("2026-09-26T10:09:00"));
  assert.strictEqual(calls.lastTriageCallAt(p), "2026-09-26 10:07:00");
});

test("rejects unknown call types", () => {
  assert.throws(() => calls.createCall(addPatient(), "lunch"), /unknown call type/);
});
