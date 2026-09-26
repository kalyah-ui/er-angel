import { Router } from "express";
import { db } from "../db/db.js";
import { callToTriage, lastTriageCallAt } from "../services/calls.js";
import { recheckFields, triggerRecheck } from "../services/recheck.js";

export const patientsRouter = Router();

// GET /patients -- list with baseline + latest reading + latest alert (for dashboard cards)
// created_at only has 1s resolution, so id breaks ties.
patientsRouter.get("/", (req, res) => {
  const patients = db.prepare("SELECT * FROM patients ORDER BY created_at DESC, id DESC").all();

  const withStatus = patients.map((p) => {
    const baselineReading = db
      .prepare("SELECT * FROM readings WHERE patient_id = ? AND is_baseline = 1 ORDER BY created_at ASC, id ASC LIMIT 1")
      .get(p.id);
    const latestReading = db
      .prepare("SELECT * FROM readings WHERE patient_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(p.id);
    const latestAlert = db
      .prepare("SELECT * FROM alerts WHERE patient_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(p.id);

    return {
      ...p,
      baseline_reading: baselineReading || null,
      latest_reading: latestReading || null,
      latest_alert: latestAlert || null,
      last_called_at: lastTriageCallAt(p.id),
      ...recheckFields(p.id), // next_recheck_at, recheck_due, missed_recheck, recheck_reminders
    };
  });

  res.json(withStatus);
});

// POST /patients/:id/call -- nurse calls the patient to the triage desk (kiosk announces it).
// Always nurse-initiated; nothing calls patients to triage automatically.
patientsRouter.post("/:id/call", (req, res) => {
  const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(req.params.id);
  if (!patient) return res.status(404).json({ error: "patient not found" });
  res.status(201).json(callToTriage(patient.id));
});

// POST /patients/:id/recheck -- kiosk demo key R: send a recheck reminder now.
patientsRouter.post("/:id/recheck", (req, res) => {
  const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(req.params.id);
  if (!patient) return res.status(404).json({ error: "patient not found" });
  res.status(201).json(triggerRecheck(patient.id));
});

patientsRouter.get("/:id", (req, res) => {
  const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(req.params.id);
  if (!patient) return res.status(404).json({ error: "not found" });
  res.json(patient);
});
