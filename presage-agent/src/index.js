import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  SmartSpectraSDK,
  breathingMetrics,
  cardioMetrics,
  decodeMetrics,
} from "@smartspectra/node-sdk";

/**
 * WaitWatch Presage Capture Agent
 * ---------------------------------
 * This is a SEPARATE small process from the main backend. It must run on
 * the actual kiosk device (the tablet/laptop with the physical webcam),
 * NOT on your cloud server -- `sdk.useCamera()` grabs whatever camera is
 * attached to the machine this process runs on.
 *
 * The kiosk browser calls this agent's local HTTP endpoint (default
 * http://localhost:4600/capture) to get a vitals reading, then forwards
 * those numbers to the main backend's existing POST /reading endpoint
 * exactly as before. This agent never talks to the main backend directly
 * -- it just answers "what are this person's vitals right now."
 */

const PORT = process.env.PORT || 4600;

if (!process.env.PRESAGE_API_KEY) {
  console.error("[presage-agent] PRESAGE_API_KEY is not set in presage-agent/.env -- exiting.");
  process.exit(1);
}

const sdk = new SmartSpectraSDK({
  apiKey: process.env.PRESAGE_API_KEY,
  requestedMetrics: [...breathingMetrics, ...cardioMetrics],
});

let collecting = false;
let samples = [];

sdk.on("processingStatus", (status) => {
  console.log("[presage-agent] processing status:", status);
});

sdk.on("validationStatus", (code, ts, hint) => {
  console.log("[presage-agent] validation:", code, hint, "at", ts, "µs");
});

sdk.on("metrics", (buf, ts) => {
  if (!collecting) return;
  const decoded = decodeMetrics(buf);
  samples.push(decoded);
});

sdk.on("error", (code, message, retryable) => {
  console.error("[presage-agent] SDK error:", code, message, "retryable=", retryable);
});

sdk.useCamera();

/**
 * Metrics field names below are best-effort based on public SmartSpectra
 * docs (iOS/edge metrics expose sdk.metrics.cardio.pulseRate and
 * sdk.metrics.breathing.rate). Run one real capture, inspect the console
 * output of decodeMetrics() below, and adjust these candidate paths if
 * the Node SDK's decoded shape differs slightly.
 */
function extractPulseRate(m) {
  return m?.cardio?.pulseRate ?? m?.cardio?.rate ?? m?.pulse?.rate ?? m?.heartRate ?? null;
}

function extractBreathingRate(m) {
  return m?.breathing?.rate ?? m?.breathingRate ?? null;
}

function average(values) {
  const nums = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (!nums.length) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

async function runCapture(durationMs) {
  samples = [];
  collecting = true;

  await sdk.start();
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  await sdk.stopAsync();

  collecting = false;

  // Log one raw sample so you can confirm the real field shape on your
  // first live run -- remove once extractPulseRate/extractBreathingRate
  // are confirmed correct for your SDK version.
  if (samples.length) {
    console.log("[presage-agent] sample decoded metrics object:", JSON.stringify(samples[0]));
  }

  const heart_rate = average(samples.map(extractPulseRate));
  const breathing_rate = average(samples.map(extractBreathingRate));

  return { heart_rate, breathing_rate, stress_score: null, sample_count: samples.length };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

let captureInFlight = false;

app.post("/capture", async (req, res) => {
  if (captureInFlight) {
    return res.status(409).json({ error: "a capture is already in progress" });
  }

  const durationMs = req.body?.duration_ms || 20000;

  captureInFlight = true;
  try {
    const result = await runCapture(durationMs);
    res.json(result);
  } catch (err) {
    console.error("[presage-agent] capture failed:", err.message);
    res.status(500).json({ error: "capture failed", detail: err.message });
  } finally {
    captureInFlight = false;
  }
});

app.listen(PORT, () => {
  console.log(`[presage-agent] listening on http://localhost:${PORT}`);
  console.log("[presage-agent] using the local camera -- keep this process on the kiosk device.");
});

process.on("SIGINT", async () => {
  console.log("\n[presage-agent] shutting down...");
  try {
    await sdk.stopAsync();
  } catch {
    // ignore if it wasn't running
  }
  await sdk.destroy();
  process.exit(0);
});
