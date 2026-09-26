import { db } from "../db/db.js";
import { classifyRisk } from "./geminiRisk.js";
import { generateAlertLine } from "./geminiAlertText.js";
import { cancelPendingRechecks } from "./calls.js";
import { toSqliteUtc } from "../logic/sqliteTime.js";

// `now` is injectable so tests control reading times (recheck timing depends on them).
export function insertReading(patientId, { heart_rate, breathing_rate, stress_score, is_baseline }, now = new Date()) {
  const info = db
    .prepare(`
      INSERT INTO readings (patient_id, heart_rate, breathing_rate, stress_score, is_baseline, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(patientId, heart_rate, breathing_rate ?? null, stress_score ?? null, is_baseline ? 1 : 0, toSqliteUtc(now));
  return db.prepare("SELECT * FROM readings WHERE id = ?").get(info.lastInsertRowid);
}

export function insertAlert(patientId, readingId, { risk_level, delta_summary, reason_text, recommended_action }) {
  const info = db
    .prepare(`
      INSERT INTO alerts (patient_id, reading_id, risk_level, delta_summary, reason_text, recommended_action)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(patientId, readingId, risk_level, delta_summary, reason_text, recommended_action);
  return db.prepare("SELECT * FROM alerts WHERE id = ?").get(info.lastInsertRowid);
}

/**
 * Stores a vitals reading. For a rescan (non-baseline), compares it to the
 * patient's baseline via Gemini and stores the resulting alert. Used by
 * POST /reading, i.e. real kiosk scans.
 *
 * Any new reading restarts the patient's recheck timer (and clears a missed
 * recheck); a reminder still queued for them is dropped.
 *
 * @param {object} patient  row from the patients table
 * @param {object} vitals   { heart_rate, breathing_rate, stress_score, is_baseline }
 * @returns {Promise<{ reading: object, alert: object|null }>}
 */
export async function recordReading(patient, vitals, now = new Date()) {
  const reading = insertReading(patient.id, vitals, now);
  cancelPendingRechecks(patient.id);

  // Baseline reading: nothing to compare against yet.
  if (vitals.is_baseline) {
    return { reading, alert: null };
  }

  const baseline = db
    .prepare("SELECT * FROM readings WHERE patient_id = ? AND is_baseline = 1 ORDER BY created_at ASC, id ASC LIMIT 1")
    .get(patient.id);

  const minutesElapsed = baseline
    ? Math.round((new Date(reading.created_at) - new Date(baseline.created_at)) / 60000)
    : 0;

  const { heart_rate, breathing_rate, stress_score } = vitals;
  const riskJson = await classifyRisk({
    baseline: baseline
      ? { heart_rate: baseline.heart_rate, breathing_rate: baseline.breathing_rate, stress_score: baseline.stress_score }
      : null,
    current: { heart_rate, breathing_rate, stress_score },
    chiefComplaint: patient.chief_complaint,
    minutesElapsed,
  });

  const reason_text = await generateAlertLine(riskJson, `Patient ${patient.id}`);
  const alert = insertAlert(patient.id, reading.id, { ...riskJson, reason_text });

  return { reading, alert };
}
