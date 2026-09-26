import { Router } from "express";
import { db } from "../db/db.js";
import { seedDemo } from "../logic/demoSeed.js";

export const adminRouter = Router();

// POST /admin/reset -- wipes all data. Body: { seed: true } to also load the
// demo patients with pre-written alerts (see logic/demoSeed.js; no Gemini calls).
adminRouter.post("/reset", (req, res) => {
  db.exec(`
    DELETE FROM calls;
    DELETE FROM alerts;
    DELETE FROM readings;
    DELETE FROM patients;
    DELETE FROM sqlite_sequence WHERE name IN ('calls', 'alerts', 'readings', 'patients');
  `);

  if (!req.body?.seed) {
    return res.json({ ok: true, seeded: false });
  }

  try {
    res.json({ ok: true, seeded: true, patients: seedDemo() });
  } catch (err) {
    console.error("[admin] demo seed failed:", err);
    res.status(500).json({ error: "demo seed failed", detail: err.message });
  }
});
