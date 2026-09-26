import { db } from "../db/db.js";
import { classifyRisk } from "./geminiRisk.js";
import { generateAlertLine } from "./geminiAlertText.js";

/**
 * Stores a vitals reading. For a rescan (non-baseline), compares it to the
 * patient's baseline via Gemini and stores the resulting alert. Shared by
 * POST /reading and the demo seeder so both go through the same pipeline.
 *
 * @param {object} patient  row from the patients table
 * @param {object} vitals   { heart_rate, breathing_rate, stress_score, is_baseline }
 * @returns {Promise<{ reading: object, alert: object|null }>}
 */
export async function recordReading(patient, { heart_rate, breathing_rate, stress_score, is_baseline }) {
  const info = db
    .prepare(`
      INSERT INTO readings (patient_id, heart_rate, breathing_rate, stress_score, is_baseline)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(patient.id, heart_rate, breathing_rate ?? null, stress_score ?? null, is_baseline ? 1 : 0);
  const reading = db.prepare("SELECT * FROM readings WHERE id = ?").get(info.lastInsertRowid);

  // Baseline reading: nothing to compare against yet.
  if (is_baseline) {
    return { reading, alert: null };
  }

  const baseline = db
    .prepare("SELECT * FROM readings WHERE patient_id = ? AND is_baseline = 1 ORDER BY created_at ASC, id ASC LIMIT 1")
    .get(patient.id);

  const minutesElapsed = baseline
    ? Math.round((new Date(reading.created_at) - new Date(baseline.created_at)) / 60000)
    : 0;

  const riskJson = await classifyRisk({
    baseline: baseline
      ? { heart_rate: baseline.heart_rate, breathing_rate: baseline.breathing_rate, stress_score: baseline.stress_score }
      : null,
    current: { heart_rate, breathing_rate, stress_score },
    chiefComplaint: patient.chief_complaint,
    minutesElapsed,
  });

  const reasonText = await generateAlertLine(riskJson, `Patient ${patient.id}`);

  const alertInfo = db
    .prepare(`
      INSERT INTO alerts (patient_id, reading_id, risk_level, delta_summary, reason_text, recommended_action)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(patient.id, reading.id, riskJson.risk_level, riskJson.delta_summary, reasonText, riskJson.recommended_action);
  const alert = db.prepare("SELECT * FROM alerts WHERE id = ?").get(alertInfo.lastInsertRowid);

  return { reading, alert };
}
