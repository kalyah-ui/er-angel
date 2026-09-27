import { db } from "../db/db.js";
import { classifyRisk } from "./geminiRisk.js";
import { generateAlertLine } from "./geminiAlertText.js";
import { evaluateEdaAlert } from "../logic/edaAlert.js";
import { cancelPendingRechecks } from "./calls.js";
import { toSqliteUtc } from "../logic/sqliteTime.js";

// `now` is injectable so tests control reading times (recheck timing depends on them).
export function insertReading(
  patientId,
  { heart_rate, breathing_rate, stress_score, face_asymmetry_score, is_baseline },
  now = new Date()
) {
  const info = db
    .prepare(`
      INSERT INTO readings (patient_id, heart_rate, breathing_rate, stress_score, face_asymmetry_score, is_baseline, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      patientId,
      heart_rate,
      breathing_rate ?? null,
      stress_score ?? null,
      face_asymmetry_score ?? null,
      is_baseline ? 1 : 0,
      toSqliteUtc(now)
    );
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
 * EDA (stress_score) escalation from Presage: at least medium, high if HR/RR
 * are also rising or Gemini already said high; explains why in the summary.
 */
function applyEdaAlert(riskJson, edaAlert) {
  const pairedVitals = edaAlert.accompanyingVitalsIncreasing;

  // Only escalate when corroborated by rising HR/RR -- isolated EDA
  // movement alone shouldn't override Gemini's own judgment, since EDA
  // is noisier and less clinically established than HR/RR/asymmetry.
  if (!pairedVitals) {
    return riskJson; // leave Gemini's assessment untouched
  }

  const edaReason = edaAlert.aboveBaseline
    ? `EDA is ${Math.round(edaAlert.percentAboveBaseline)}% above its rolling baseline`
    : "EDA has risen for 3 consecutive check-ins";
  const increasingVitals = [
    edaAlert.heartRateIncreasing ? "heart rate" : null,
    edaAlert.breathingRateIncreasing ? "breathing rate" : null,
  ].filter(Boolean).join(" and ");

  return {
    ...riskJson,
    // Escalate, never downgrade below what Gemini already concluded.
    risk_level: riskJson.risk_level === "high" ? "high" : "medium",
    delta_summary: `${riskJson.delta_summary} EDA alert: ${edaReason}, with increasing ${increasingVitals}.`,
    recommended_action: "Prompt nurse reassessment due to concurrent EDA and vital-sign increases.",
  };
}

/**
 * Stores a vitals reading. For a rescan (non-baseline), compares it to the
 * patient's baseline via Gemini, applies the EDA check (rising stress_score
 * over the last few readings), and stores the resulting alert. Used by
 * POST /reading, i.e. real kiosk scans.
 *
 * Any new reading restarts the patient's recheck timer (and clears a missed
 * recheck); a reminder still queued for them is dropped.
 *
 * @param {object} patient  row from the patients table
 * @param {object} vitals   { heart_rate, breathing_rate, stress_score, face_asymmetry_score, is_baseline }
 * @returns {Promise<{ reading: object, alert: object|null }>}
 */
export async function recordReading(patient, vitals, now = new Date()) {
  const reading = insertReading(patient.id, vitals, now);
  cancelPendingRechecks(patient.id);

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

  const history = db
    .prepare("SELECT heart_rate, breathing_rate, stress_score FROM readings WHERE patient_id = ? AND id < ? ORDER BY id DESC LIMIT 5")
    .all(patient.id, reading.id)
    .reverse();
  const edaAlert = evaluateEdaAlert({ current: { heart_rate, breathing_rate, stress_score }, history });

  let riskJson = await classifyRisk({
    baseline: baseline
      ? { heart_rate: baseline.heart_rate, breathing_rate: baseline.breathing_rate, stress_score: baseline.stress_score }
      : null,
    current: { heart_rate, breathing_rate, stress_score },
    chiefComplaint: patient.chief_complaint,
    minutesElapsed,
  });

  // Only escalate when EDA is corroborated by rising HR/RR -- isolated
  // EDA movement alone shouldn't override or bypass Gemini's own
  // assessment. This must match the condition applyEdaAlert uses
  // internally, since that's what actually determines whether riskJson
  // was modified.
  const edaEscalated = edaAlert.triggered && edaAlert.accompanyingVitalsIncreasing;
  if (edaEscalated) riskJson = applyEdaAlert(riskJson, edaAlert);

  const label = `Patient ${patient.id}`;
  const reason_text = edaEscalated
    ? `${label}: ${riskJson.delta_summary}`
    : await generateAlertLine(riskJson, label);

  const alert = insertAlert(patient.id, reading.id, { ...riskJson, reason_text });

  return { reading, alert };
}