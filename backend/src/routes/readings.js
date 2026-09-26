import { Router } from "express";
import { db } from "../db/db.js";
import { classifyRisk } from "../services/geminiRisk.js";
import { generateAlertLine } from "../services/geminiAlertText.js";
import { evaluateEdaAlert } from "../logic/edaAlert.js";

export const readingsRouter = Router();

// POST /reading
// { patient_id, heart_rate, breathing_rate, stress_score, face_asymmetry_score, is_baseline }
readingsRouter.post("/", async (req, res) => {
  const { patient_id, heart_rate, breathing_rate, stress_score, face_asymmetry_score, is_baseline } = req.body;

  if (!patient_id || heart_rate == null) {
    return res.status(400).json({ error: "patient_id and heart_rate are required" });
  }

  const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(patient_id);
  if (!patient) return res.status(404).json({ error: "patient not found" });

  const insertReading = db.prepare(`
    INSERT INTO readings (patient_id, heart_rate, breathing_rate, stress_score, face_asymmetry_score, is_baseline)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = insertReading.run(
    patient_id,
    heart_rate,
    breathing_rate ?? null,
    stress_score ?? null,
    face_asymmetry_score ?? null,
    is_baseline ? 1 : 0
  );
  const reading = db.prepare("SELECT * FROM readings WHERE id = ?").get(info.lastInsertRowid);

  // Baseline reading: nothing to compare against yet.
  if (is_baseline) {
    return res.status(201).json({ reading, alert: null });
  }

  const baseline = db
    .prepare("SELECT * FROM readings WHERE patient_id = ? AND is_baseline = 1 ORDER BY created_at ASC LIMIT 1")
    .get(patient_id);

  const history = db
    .prepare("SELECT heart_rate, breathing_rate, stress_score FROM readings WHERE patient_id = ? AND id < ? ORDER BY id DESC LIMIT 5")
    .all(patient_id, reading.id)
    .reverse();

  const edaAlert = evaluateEdaAlert({
    current: { heart_rate, breathing_rate, stress_score },
    history,
  });

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

  if (edaAlert.triggered) {
    const pairedVitals = edaAlert.accompanyingVitalsIncreasing;
    riskJson.risk_level = pairedVitals || riskJson.risk_level === "high"
      ? "high"
      : "medium";
    const edaReason = edaAlert.aboveBaseline
      ? `EDA is ${Math.round(edaAlert.percentAboveBaseline)}% above its rolling baseline`
      : "EDA has risen for 3 consecutive check-ins";
    const increasingVitals = [
      edaAlert.heartRateIncreasing ? "heart rate" : null,
      edaAlert.breathingRateIncreasing ? "breathing rate" : null,
    ].filter(Boolean).join(" and ");
    riskJson.delta_summary = `${riskJson.delta_summary} EDA alert: ${edaReason}${pairedVitals ? `, with increasing ${increasingVitals}` : ""}.`;
    riskJson.recommended_action = pairedVitals
      ? "Prompt nurse reassessment due to concurrent EDA and vital-sign increases."
      : "Nurse review recommended; repeat vitals and assess the patient.";
  }

  const patientLabel = `Patient ${patient.id}`;
  const reasonText = edaAlert.triggered
    ? `${patientLabel}: ${riskJson.delta_summary}`
    : await generateAlertLine(riskJson, patientLabel);

  const insertAlert = db.prepare(`
    INSERT INTO alerts (patient_id, reading_id, risk_level, delta_summary, reason_text, recommended_action)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const alertInfo = insertAlert.run(
    patient_id,
    reading.id,
    riskJson.risk_level,
    riskJson.delta_summary,
    reasonText,
    riskJson.recommended_action
  );
  const alert = db.prepare("SELECT * FROM alerts WHERE id = ?").get(alertInfo.lastInsertRowid);

  res.status(201).json({ reading, alert });
});

// GET /patients/:id/readings
readingsRouter.get("/patient/:id", (req, res) => {
  const readings = db
    .prepare("SELECT * FROM readings WHERE patient_id = ? ORDER BY created_at ASC")
    .all(req.params.id);
  res.json(readings);
});
