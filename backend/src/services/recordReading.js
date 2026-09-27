import { db } from "../db/db.js";
import { classifyRisk } from "./geminiRisk.js";
import { generateAlertLine } from "./geminiAlertText.js";
import { evaluateEdaAlert, meaningfulVitalsRise } from "../logic/edaAlert.js";
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
 * EDA (stress_score) escalation from Presage. Only called when EDA triggered
 * AND heart rate or breathing rate rose meaningfully since triage (see
 * EDA_ESCALATION): raises the risk to "medium", never lowers it, and says why.
 */
function applyEdaAlert(riskJson, edaAlert, rise, currentEda) {
  // Absolute values, not percentages: EDA baselines sit near zero, where
  // percentages exaggerate tiny changes.
  const edaReason = edaAlert.aboveBaseline
    ? `EDA ${currentEda.toFixed(3)} vs rolling baseline ${edaAlert.rollingBaseline.toFixed(3)}`
    : "EDA has risen for 3 consecutive check-ins";
  const vitals = [
    rise.heartRate ? `HR up ${Math.round(rise.hrRise)} bpm` : null,
    rise.breathingRate ? `RR up ${Math.round(rise.rrRise)} breaths/min` : null,
  ].filter(Boolean).join(" and ");

  return {
    ...riskJson,
    risk_level: riskJson.risk_level === "high" ? "high" : "medium",
    delta_summary: `${riskJson.delta_summary} EDA alert: ${edaReason}, with ${vitals} since triage.`,
    recommended_action: "Reassess the patient: EDA and vital signs are rising together.",
  };
}

const vitalsForGemini = (r) => ({
  heart_rate: r.heart_rate ?? null,
  breathing_rate: r.breathing_rate ?? null,
  stress_score: r.stress_score ?? null,
  face_asymmetry_score: r.face_asymmetry_score ?? null,
});

/**
 * Stores a vitals reading. For a rescan (non-baseline), compares it to the
 * patient's baseline via Gemini (HR, RR, EDA, face asymmetry), applies the
 * EDA check (rising stress_score over the last few readings), and stores the
 * resulting alert. Used by POST /reading, i.e. real kiosk scans.
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
    baseline: baseline ? vitalsForGemini(baseline) : null,
    current: vitalsForGemini(vitals),
    chiefComplaint: patient.chief_complaint,
    minutesElapsed,
  });

  // EDA alone never escalates: only with a meaningful HR/RR rise since
  // triage (EDA_ESCALATION), and then only to "medium".
  const rise = meaningfulVitalsRise({ baseline, current: { heart_rate, breathing_rate } });
  const edaEscalated = edaAlert.triggered && rise.any;
  if (edaEscalated) riskJson = applyEdaAlert(riskJson, edaAlert, rise, stress_score);

  const label = `Patient ${patient.id}`;
  const reason_text = edaEscalated
    ? `${label}: ${riskJson.delta_summary}`
    : await generateAlertLine(riskJson, label);

  const alert = insertAlert(patient.id, reading.id, { ...riskJson, reason_text });

  return { reading, alert };
}