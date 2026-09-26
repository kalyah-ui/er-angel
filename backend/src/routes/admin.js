import { Router } from "express";
import { db } from "../db/db.js";

export const adminRouter = Router();

// POST /admin/reset -- wipes all data. Optionally seeds demo patients.
// Body: { seed: true } to also insert a couple of demo patients + baselines.
adminRouter.post("/reset", (req, res) => {
  db.exec(`
    DELETE FROM alerts;
    DELETE FROM readings;
    DELETE FROM patients;
    DELETE FROM sqlite_sequence WHERE name IN ('alerts', 'readings', 'patients');
  `);

  if (req.body?.seed) {
    const insertPatient = db.prepare(
      "INSERT INTO patients (name, chief_complaint) VALUES (?, ?)"
    );
    const insertReading = db.prepare(`
      INSERT INTO readings (patient_id, heart_rate, breathing_rate, is_baseline)
      VALUES (?, ?, ?, 1)
    `);

    const demoPatients = [
      { name: "Alex Chen", complaint: "Mild chest tightness", hr: 78, rr: 15 },
      { name: "Jordan Smith", complaint: "Twisted ankle", hr: 70, rr: 14 },
    ];

    for (const p of demoPatients) {
      const info = insertPatient.run(p.name, p.complaint);
      insertReading.run(info.lastInsertRowid, p.hr, p.rr);
    }
  }

  res.json({ ok: true, seeded: !!req.body?.seed });
});