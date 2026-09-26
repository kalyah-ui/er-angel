import { Router } from "express";
import { db } from "../db/db.js";
import { recordReading } from "../services/recordReading.js";

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

  const result = await recordReading(patient, { heart_rate, breathing_rate, stress_score, face_asymmetry_score, is_baseline });
  res.status(201).json(result);
});

// GET /patients/:id/readings
readingsRouter.get("/patient/:id", (req, res) => {
  const readings = db
    .prepare("SELECT * FROM readings WHERE patient_id = ? ORDER BY created_at ASC")
    .all(req.params.id);
  res.json(readings);
});
