import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  SmartSpectraSDK,
  breathingMetrics,
  cardioMetrics,
  faceMetrics,
  edaMetrics,
  decodeMetrics,
} from "@smartspectra/node-sdk";
import { averageAsymmetryScore } from "./faceAsymmetry.js";

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

// Breathing rate needs the chest/torso visible in frame -- position your
// camera further back (or angled down) so your torso is in shot, not just
// your face, or you'll see "Place more of the chest in view" validation
// warnings again.
// edaMetrics (electrodermal activity / skin conductance) was NOT in the
// documentation originally reviewed for this project -- it showed up as
// an export in the SDK package itself, so treat its exact shape as
// unconfirmed until the diagnostic scan below shows real data.
const sdk = new SmartSpectraSDK({
  apiKey: process.env.PRESAGE_API_KEY,
  requestedMetrics: [...cardioMetrics, ...breathingMetrics, ...faceMetrics, ...edaMetrics],
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
 * DIAGNOSTIC MODE: the decoded metrics stream sends partial updates --
 * some samples are just a raw waveform point (e.g. {breathing:{upperTrace:
 * [...]}}), not a computed rate. The actual rate/confidence value likely
 * arrives in a DIFFERENT sample later in the stream, once the SDK has
 * accumulated enough signal (rPPG needs the full window, not sample 1).
 *
 * Rather than guess field names again, we scan every sample's full JSON
 * for the substrings "rate" or "pulse" and log any hit. Run a real
 * ~20-30s capture and check the agent terminal for a line starting with
 * "[presage-agent] FOUND rate-like field" -- that tells us the real path.
 */
function scanForRateFields(samples) {
  const seenKeys = new Set();
  samples.forEach((s) => collectKeys(s, "", seenKeys));
  console.log("[presage-agent] all top-level+nested keys seen across samples:", [...seenKeys].sort());

  samples.forEach((s, i) => {
    const json = JSON.stringify(s);
    if (/rate|pulse|bpm/i.test(json)) {
      console.log(`[presage-agent] FOUND rate-like field in sample ${i}:`, json);
    }
    // Once faceMetrics is added to requestedMetrics above, this will help
    // find the real landmark field path -- look for a "FOUND face-like
    // field" line and note whether it's an array of {x,y} points.
    if (/landmark|face/i.test(json)) {
      // Truncate to keep the log readable -- landmark arrays are long (478 points).
      console.log(`[presage-agent] FOUND face-like field in sample ${i}:`, json.slice(0, 500) + "...");
    }
    // eda/electrodermal/conductance -- shape is completely unknown, this
    // SDK export wasn't in the docs we reviewed. Look for a "FOUND eda-like
    // field" line and inspect its structure before writing extraction logic.
    if (/eda|electrodermal|conductance|\bscr\b|\bscl\b/i.test(json)) {
      console.log(`[presage-agent] FOUND eda-like field in sample ${i}:`, json.slice(0, 500) + "...");
    }
  });
}

function collectKeys(obj, prefix, out) {
  if (obj == null || typeof obj !== "object") return;
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    collectKeys(obj[key], path, out);
  }
}

// CONFIRMED from live diagnostic output: pulseRate is an ARRAY of
// { value, stable, confidence, timestamp } entries, not a plain number.
// Only trust entries marked stable -- early samples during the first few
// seconds of a capture are often unstable while the algorithm locks on.
function extractPulseRate(m) {
  const entries = m?.cardio?.pulseRate;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const stableEntries = entries.filter((e) => e.stable);
  const best = stableEntries.length ? stableEntries : entries;
  // average the value across all entries in this sample (usually just one)
  const vals = best.map((e) => e.value).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

// UNCONFIRMED GUESS -- pulseRate turned out to live at m.cardio.pulseRate
// as an array of {value, stable, confidence, timestamp}, so breathing is
// likely the same shape at m.breathing.breathingRate, but this has NOT
// been verified against real data yet. Run a capture now that
// breathingMetrics is requested above, check the terminal for a line like
// "FOUND rate-like field in sample N: {...}", and fix this path to match
// whatever it actually shows -- the same way extractPulseRate got fixed.
function extractBreathingRate(m) {
  const entries = m?.breathing?.breathingRate ?? m?.breathing?.rate;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const stableEntries = entries.filter((e) => e.stable);
  const best = stableEntries.length ? stableEntries : entries;
  const vals = best.map((e) => e.value).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

// CONFIRMED from live diagnostic output: m.face.landmarks is an array of
// { value: [...478 {x,y} points...] } entries (usually one per sample),
// NOT a flat array of points itself -- the points are one level deeper,
// under .value. Coordinates are pixel values (e.g. x:937,y:587), not
// normalized 0-1, but that's fine -- computeAsymmetryScore normalizes by
// inter-eye distance so absolute pixel scale doesn't matter.
function extractLandmarks(m) {
  const entries = m?.face?.landmarks;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const first = entries[0];
  return Array.isArray(first?.value) ? first.value : null;
}

// UNCONFIRMED -- edaMetrics wasn't in the docs we reviewed, so this is a
// blind guess at the shape based on the pattern every other metric
// category has followed so far (an array of {value, ...} entries, or a
// nested {value: [...]} wrapper like landmarks). DO NOT trust this until
// you've seen a real "FOUND eda-like field" log line and confirmed the
// actual path -- same process as pulseRate and landmarks.
function extractEda(m) {
  const entries = m?.eda?.trace ?? m?.eda?.level ?? m?.eda?.value ?? m?.eda?.scr ?? m?.eda?.tonic;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const vals = entries.map((e) => (typeof e === "number" ? e : e?.value)).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
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

  try {
    await sdk.stopAsync();
  } catch (err) {
    // The SDK can transition to a stopped/error state on its own after
    // repeated validation failures (e.g. sustained bad framing), in which
    // case calling stopAsync() again throws "not in a valid state." This
    // isn't fatal to the capture -- log it and continue, since whatever
    // samples we did collect before it gave up are still usable.
    console.warn("[presage-agent] stopAsync warning (likely already stopped):", err.message);
  }

  collecting = false;

  if (samples.length) {
    scanForRateFields(samples);
  }

  if (samples.length === 0) {
    throw new Error(
      "No valid metrics captured -- check framing/lighting and try again. " +
        "See the [presage-agent] validation logs above for the specific hint."
    );
  }

  const heart_rate = average(samples.map(extractPulseRate));
  const breathing_rate = average(samples.map(extractBreathingRate));

  const landmarkSamples = samples.map(extractLandmarks).filter(Boolean);
  const face_asymmetry_score = landmarkSamples.length
    ? averageAsymmetryScore(landmarkSamples)
    : null;

  // stress_score is now sourced from EDA once extractEda's field path is
  // confirmed against real diagnostic output -- will be null until then.
  const stress_score = average(samples.map(extractEda));

  return {
    heart_rate,
    breathing_rate,
    stress_score,
    face_asymmetry_score,
    sample_count: samples.length,
  };
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
