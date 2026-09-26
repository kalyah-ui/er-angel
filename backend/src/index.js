import "dotenv/config";
import express from "express";
import cors from "cors";

import "./db/db.js"; // initializes DB + runs schema on boot
import { checkinRouter } from "./routes/checkin.js";
import { readingsRouter } from "./routes/readings.js";
import { patientsRouter } from "./routes/patients.js";
import { alertsRouter } from "./routes/alerts.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/checkin", checkinRouter);
app.use("/reading", readingsRouter);
app.use("/patients", patientsRouter);
app.use("/alerts", alertsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[waitwatch-backend] listening on http://localhost:${PORT}`);
});
