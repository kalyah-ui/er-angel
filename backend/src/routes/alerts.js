import { Router } from "express";
import { db } from "../db/db.js";

export const alertsRouter = Router();

// GET /alerts -- unacknowledged first, high risk first
alertsRouter.get("/", (req, res) => {
  const alerts = db
    .prepare(`
      SELECT alerts.*, patients.name as patient_name
      FROM alerts
      JOIN patients ON patients.id = alerts.patient_id
      ORDER BY
        acknowledged ASC,
        CASE risk_level WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
        alerts.created_at DESC
    `)
    .all();

  res.json(alerts);
});

// POST /alerts/:id/ack
alertsRouter.post("/:id/ack", (req, res) => {
  db.prepare("UPDATE alerts SET acknowledged = 1 WHERE id = ?").run(req.params.id);
  const alert = db.prepare("SELECT * FROM alerts WHERE id = ?").get(req.params.id);
  res.json(alert);
});
