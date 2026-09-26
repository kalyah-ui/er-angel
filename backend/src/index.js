import "dotenv/config";
import express from "express";
import cors from "cors";

import { db } from "./db/db.js"; // initializes DB + runs schema on boot
import { checkinRouter } from "./routes/checkin.js";
import { readingsRouter } from "./routes/readings.js";
import { patientsRouter } from "./routes/patients.js";
import { alertsRouter } from "./routes/alerts.js";
import { adminRouter } from "./routes/admin.js";
import { speakRouter } from "./routes/speak.js";
import { callsRouter } from "./routes/calls.js";
import { recheckAutoEnabled, startRecheckScheduler } from "./services/recheck.js";
import { recheckTimeScale } from "./logic/recheck.js";
import { startBackupScheduler } from "./services/dbBackup.js";

// CORS_ORIGINS (comma-separated) restricts which browser origins may call the
// API cross-origin -- in production just the kiosk laptop. Unset = allow all
// (local dev).
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : undefined));
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
const server = app.listen(PORT, () => {
  console.log(`[er-angel-backend] listening on port ${PORT}`);
  console.log(`[cors] ${corsOrigins.length ? `allowed origins: ${corsOrigins.join(", ")}` : "all origins allowed (CORS_ORIGINS unset)"}`);
  startRecheckScheduler();
  startBackupScheduler();
  console.log(
    recheckAutoEnabled()
      ? `[recheck] automatic reminders on, RECHECK_TIME_SCALE=${recheckTimeScale()}`
      : "[recheck] automatic reminders OFF (RECHECK_AUTO=false) -- only the kiosk's R key triggers them"
  );
});

// `docker stop` sends SIGTERM; Node as PID 1 ignores it by default and gets
// killed 10s later. Finish in-flight requests and close SQLite cleanly.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[er-angel-backend] ${signal} received, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
