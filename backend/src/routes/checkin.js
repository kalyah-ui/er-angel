import { Router } from "express";
import { db } from "../db/db.js";

export const checkinRouter = Router();

// POST /checkin  { name, chief_complaint }
checkinRouter.post("/", (req, res) => {
  const { name, chief_complaint } = req.body;

  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const stmt = db.prepare(
    "INSERT INTO patients (name, chief_complaint) VALUES (?, ?)"
  );
  const info = stmt.run(name, chief_complaint || null);

  const patient = db
    .prepare("SELECT * FROM patients WHERE id = ?")
    .get(info.lastInsertRowid);

  res.status(201).json(patient);
});
