import "dotenv/config";
import express from "express";
import cors from "cors";

import "./db/db.js"; // initializes DB + runs schema on boot
import { checkinRouter } from "./routes/checkin.js";
import { readingsRouter } from "./routes/readings.js";
import { patientsRouter } from "./routes/patients.js";
import { alertsRouter } from "./routes/alerts.js";
import { adminRouter } from "./routes/admin.js";
import { speakRouter } from "./routes/speak.js";
import { callsRouter } from "./routes/calls.js";
import { recheckAutoEnabled, startRecheckScheduler } from "./services/recheck.js";
import { recheckTimeScale } from "./logic/recheck.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/checkin", checkinRouter);
app.use("/reading", readingsRouter);
app.use("/patients", patientsRouter);
app.use("/alerts", alertsRouter);
app.use("/admin", adminRouter);
app.use("/speak", speakRouter);
app.use("/calls", callsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[waitwatch-backend] listening on http://localhost:${PORT}`);
  startRecheckScheduler();
  console.log(
    recheckAutoEnabled()
      ? `[recheck] automatic reminders on, RECHECK_TIME_SCALE=${recheckTimeScale()}`
      : "[recheck] automatic reminders OFF (RECHECK_AUTO=false) -- only the kiosk's R key triggers them"
  );
});
