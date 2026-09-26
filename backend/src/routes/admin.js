import { Router } from "express";
import { db } from "../db/db.js";
import { seedDemo } from "../logic/demoSeed.js";

export const adminRouter = Router();

// POST /admin/reset -- wipes all data. Body: { seed: true } to also load the
// demo patients (see logic/demoSeed.js). Seeding runs real Gemini calls, so
// it takes a few seconds.
adminRouter.post("/reset", async (req, res) => {
  db.exec(`
    DELETE FROM alerts;
    DELETE FROM readings;
    DELETE FROM patients;
    DELETE FROM sqlite_sequence WHERE name IN ('alerts', 'readings', 'patients');
  `);

  if (!req.body?.seed) {
    return res.json({ ok: true, seeded: false });
  }

  try {
    const patients = await seedDemo();
    res.json({ ok: true, seeded: true, patients });
  } catch (err) {
    console.error("[admin] demo seed failed:", err);
    res.status(500).json({ error: "demo seed failed", detail: err.message });
  }
});
