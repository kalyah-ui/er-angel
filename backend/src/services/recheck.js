import { db } from "../db/db.js";
import { recheckStatus } from "../logic/recheck.js";
import { parseSqliteUtc, toSqliteUtc } from "../logic/sqliteTime.js";
import { createCall } from "./calls.js";

const TICK_MS = 5000;

/** Recheck status for one patient row (see logic/recheck.js). */
export function patientRecheckStatus(patientId, now = new Date()) {
  const latestReading = db
    .prepare("SELECT created_at FROM readings WHERE patient_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(patientId);
  if (!latestReading) {
    return recheckStatus({ latestReadingAt: null, riskLevel: null, remindersSince: [], calledToTriage: false, now });
  }

  const since = latestReading.created_at;
  const riskLevel =
    db.prepare("SELECT risk_level FROM alerts WHERE patient_id = ? ORDER BY created_at DESC, id DESC LIMIT 1").get(patientId)
      ?.risk_level ?? null;
  const remindersSince = db
    .prepare("SELECT created_at FROM calls WHERE patient_id = ? AND type = 'recheck' AND created_at >= ? ORDER BY created_at, id")
    .all(patientId, since)
    .map((c) => parseSqliteUtc(c.created_at));
  const calledToTriage = Boolean(
    db.prepare("SELECT 1 FROM calls WHERE patient_id = ? AND type = 'triage' AND created_at >= ? LIMIT 1").get(patientId, since)
  );

  return recheckStatus({
    latestReadingAt: parseSqliteUtc(since),
    riskLevel: riskLevel?.toLowerCase() ?? null,
    remindersSince,
    calledToTriage,
    now,
  });
}

/** The recheck fields GET /patients adds to each patient. */
export function recheckFields(patientId, now = new Date()) {
  const status = patientRecheckStatus(patientId, now);
  return {
    next_recheck_at: status.next_recheck_at ? toSqliteUtc(status.next_recheck_at) : null,
    recheck_due: status.recheck_due,
    missed_recheck: status.missed_recheck,
    recheck_reminders: status.reminders_sent,
  };
}

/** One scheduler pass: queue a recheck reminder for every patient who needs one. Returns the calls created. */
export function runRecheckTick(now = new Date()) {
  const created = [];
  for (const { id } of db.prepare("SELECT id FROM patients").all()) {
    const status = patientRecheckStatus(id, now);
    if (!status.remind) continue;
    created.push(createCall(id, "recheck", now));
    console.log(`[recheck] patient #${id}: reminder ${status.reminders_sent + 1} queued`);
  }
  return created;
}

export function startRecheckScheduler() {
  const timer = setInterval(() => {
    try {
      runRecheckTick();
    } catch (err) {
      console.error("[recheck] scheduler tick failed:", err);
    }
  }, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
