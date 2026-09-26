import { db } from "../db/db.js";
import { toSqliteUtc } from "../logic/sqliteTime.js";

export const CALL_TYPES = ["triage", "recheck"];

/** `now` is injectable so tests (and the recheck scheduler) control timestamps. */
export function createCall(patientId, type, now = new Date()) {
  if (!CALL_TYPES.includes(type)) throw new Error(`unknown call type: ${type}`);
  const info = db
    .prepare("INSERT INTO calls (patient_id, type, created_at) VALUES (?, ?, ?)")
    .run(patientId, type, toSqliteUtc(now));
  return db.prepare("SELECT * FROM calls WHERE id = ?").get(info.lastInsertRowid);
}

/**
 * Nurse calls a patient to the triage desk. Any queued recheck reminder for
 * them is dropped -- they're being seen, so it's moot.
 */
export function callToTriage(patientId, now = new Date()) {
  cancelPendingRechecks(patientId);
  return createCall(patientId, "triage", now);
}

/** Unannounced calls, triage before recheck, oldest first. Patient number only -- no names. */
export function pendingCalls() {
  return db
    .prepare(`
      SELECT id, patient_id, type, created_at FROM calls
      WHERE announced = 0
      ORDER BY CASE type WHEN 'triage' THEN 0 ELSE 1 END, created_at ASC, id ASC
    `)
    .all();
}

export function markAnnounced(callId) {
  db.prepare("UPDATE calls SET announced = 1 WHERE id = ?").run(callId);
  return db.prepare("SELECT * FROM calls WHERE id = ?").get(callId) || null;
}

/** A recheck reminder that's still queued is pointless once the patient rescans or is called. */
export function cancelPendingRechecks(patientId) {
  db.prepare("UPDATE calls SET announced = 1 WHERE patient_id = ? AND type = 'recheck' AND announced = 0").run(patientId);
}

export function lastTriageCallAt(patientId) {
  return (
    db
      .prepare("SELECT created_at FROM calls WHERE patient_id = ? AND type = 'triage' ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(patientId)?.created_at ?? null
  );
}
