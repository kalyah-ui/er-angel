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
  ValidationCode,
} from "@smartspectra/node-sdk";
import { averageAsymmetryScore } from "./faceAsymmetry.js";

const PORT = process.env.PORT || 4600;

if (!process.env.PRESAGE_API_KEY) {
  console.error("[presage-agent] PRESAGE_API_KEY is not set in presage-agent/.env -- exiting.");
  process.exit(1);
}

const sdk = new SmartSpectraSDK({
  apiKey: process.env.PRESAGE_API_KEY,
  requestedMetrics: [...cardioMetrics, ...breathingMetrics, ...faceMetrics, ...edaMetrics],
});

let collecting = false;
let samples = [];

// Set by POST /cancel while a capture is in flight. Checked inside
// runCapture's loop so the SDK is actually stopped and the in-flight
// /capture request resolves promptly, instead of the frontend merely
// navigating away while the agent keeps the camera running underneath.
let cancelRequested = false;

// Bad validation events (e.g. kChestNotVisible, kFaceTooLow) fire
// repeatedly (~every 30ms) while a problem persists, but the SDK appears
// to NEVER emit an explicit "all clear" / kOk event once framing becomes
// good again -- it just stops emitting entirely. So instead of trusting
// the last-seen code forever (which froze the countdown permanently once
// a single bad event fired), we track WHEN the last bad event arrived and
// treat framing as good again once that event goes stale (i.e. no new bad
// event has landed in FRAMING_STALE_MS).
let lastBadValidation = { code: null, hint: null, receivedAt: null };

// TUNING: measured via the diagnostic "validation gap" log below. If your
// real repeat interval during a sustained problem is consistently under
// ~100ms, 150ms is safe. If you see occasional jitter up to 120-150ms,
// stay at 200ms or a bit higher -- you want at least one full jittery gap
// of margin, or the UI will flicker between blocked/resumed.
const FRAMING_STALE_MS = 200;

// Accumulated milliseconds of GOOD framing toward the capture target, vs.
// targetMs (the requested duration). Wall-clock time keeps running during
// bad framing, but doesn't count toward the target, so a patient with poor
// framing for the first 10s of a 30s capture still ends up with a full 30s
// of usable data -- just takes longer in real time.
let goodElapsedMs = 0;
let targetMs = 0;

sdk.on("processingStatus", (status) => {
  console.log("[presage-agent] processing status:", status);
});

sdk.on("validationStatus", (code, ts, hint) => {
  const now = Date.now();

  // DIAGNOSTIC: logs the real gap between consecutive bad events so you
  // can confirm/tune FRAMING_STALE_MS against actual data. Safe to delete
  // once you're confident in the threshold.
  if (code !== ValidationCode.kOk && lastBadValidation.receivedAt != null) {
    console.log(
      "[presage-agent] validation gap:",
      now - lastBadValidation.receivedAt,
      "ms since last bad event"
    );
  }

  console.log("[presage-agent] validation:", code, hint, "at", ts, "µs");

  if (code !== ValidationCode.kOk) {
    lastBadValidation = { code, hint: hint || null, receivedAt: now };
  } else {
    // In case the SDK *does* sometimes send kOk explicitly, honor it
    // immediately rather than waiting out the staleness window.
    lastBadValidation = { code: null, hint: null, receivedAt: null };
  }
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

function scanForRateFields(samples) {
  const seenKeys = new Set();
  samples.forEach((s) => collectKeys(s, "", seenKeys));
  console.log("[presage-agent] all top-level+nested keys seen across samples:", [...seenKeys].sort());

  samples.forEach((s, i) => {
    const json = JSON.stringify(s);
    if (/rate|pulse|bpm/i.test(json)) {
      console.log(`[presage-agent] FOUND rate-like field in sample ${i}:`, json);
    }
    if (/landmark|face/i.test(json)) {
      console.log(`[presage-agent] FOUND face-like field in sample ${i}:`, json.slice(0, 500) + "...");
    }
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

function extractPulseRate(m) {
  const entries = m?.cardio?.pulseRate;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const stableEntries = entries.filter((e) => e.stable);
  const best = stableEntries.length ? stableEntries : entries;
  const vals = best.map((e) => e.value).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

function extractBreathingRate(m) {
  const entries = m?.breathing?.breathingRate ?? m?.breathing?.rate;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const stableEntries = entries.filter((e) => e.stable);
  const best = stableEntries.length ? stableEntries : entries;
  const vals = best.map((e) => e.value).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return vals.reduce((sum, v) => sum + v, 0) / vals.length;
}

function extractLandmarks(m) {
  const entries = m?.face?.landmarks;
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const first = entries[0];
  return Array.isArray(first?.value) ? first.value : null;
}

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

const TICK_MS = 200;
// Safety cap so a capture doesn't hang forever if framing never improves --
// stop anyway after 3x the requested duration and use whatever was collected.
const MAX_WALL_CLOCK_MULTIPLIER = 3;

// CONFIRMED authoritative list, via:
//   node -e "import('@smartspectra/node-sdk').then(m => console.log(m.ValidationCode))"
// {
//   kOk: 0, kNoFaceFound: 1, kMultipleFacesFound: 2, kFaceNotCentered: 3,
//   kFaceSizeOutOfRange: 4, kTooDark: 5, kTooBright: 6, kChestNotVisible: 7,
//   kCameraTuning: 10, kFrameRateTooLow: 11, kExcessiveMotion: 12,
//   kFaceTooClose: 13, kFaceTooFar: 14, kFaceTooHigh: 15, kFaceTooLow: 16,
//   kFaceNotForward: 17
// }
// kOk (0) is the only "everything is fine" state -- its accompanying hint
// text (e.g. "Hold still and record.") is just reassurance, not a warning.
// Every other code is a real problem that should pause progress.
//
// Framing is blocking if we've seen a bad event that hasn't gone stale
// yet -- see lastBadValidation / FRAMING_STALE_MS above for why this
// replaced the old "trust the last code forever" approach, which caused
// the countdown to freeze permanently after a single bad event.
function isFramingBlocking() {
  if (lastBadValidation.code == null) return false;
  return Date.now() - lastBadValidation.receivedAt < FRAMING_STALE_MS;
}

// Thrown when a client explicitly cancels an in-progress capture, so the
// /capture route can respond with a distinct status instead of treating
// it as a real capture failure (which would send the patient to the front
// desk via showFrontDesk on the frontend).
class CaptureCancelledError extends Error {
  constructor() {
    super("capture cancelled");
    this.name = "CaptureCancelledError";
  }
}

async function runCapture(durationMs) {
  samples = [];
  collecting = true;
  cancelRequested = false;
  lastBadValidation = { code: null, hint: null, receivedAt: null };
  goodElapsedMs = 0;
  targetMs = durationMs;

  await sdk.start();

  const wallClockStart = Date.now();
  let lastTick = wallClockStart;
  const maxWallClockMs = durationMs * MAX_WALL_CLOCK_MULTIPLIER;
  let cancelled = false;

  while (goodElapsedMs < durationMs) {
    if (cancelRequested) {
      console.log("[presage-agent] capture cancelled by client request.");
      cancelled = true;
      break;
    }
    if (Date.now() - wallClockStart > maxWallClockMs) {
      console.warn(
        "[presage-agent] capture exceeded max wall-clock time waiting for good framing -- stopping with partial data."
      );
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
    const now = Date.now();
    const tickElapsed = now - lastTick;
    lastTick = now;

    const framingOk = !isFramingBlocking();
    if (framingOk) goodElapsedMs += tickElapsed;
  }

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
  cancelRequested = false;

  if (cancelled) {
    throw new CaptureCancelledError();
  }

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

app.get("/status", (req, res) => {
  const blocking = isFramingBlocking();
  res.json({
    collecting,
    // Only surface the code/hint while actually blocking -- once the
    // staleness window clears, don't keep echoing stale problem text
    // down to the kiosk UI.
    code: blocking ? lastBadValidation.code : null,
    hint: blocking ? lastBadValidation.hint : null,
    blocking,
    goodElapsedMs,
    targetMs,
  });
});

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
    if (err instanceof CaptureCancelledError) {
      // Not a failure -- the client asked us to stop. 499 (nonstandard but
      // widely used for "client closed/cancelled request") so the kiosk can
      // tell this apart from a real capture error and skip the front-desk
      // fallback screen.
      console.log("[presage-agent] capture cancelled, responding 499.");
      res.status(499).json({ error: "cancelled" });
    } else {
      console.error("[presage-agent] capture failed:", err.message);
      res.status(500).json({ error: "capture failed", detail: err.message });
    }
  } finally {
    captureInFlight = false;
  }
});

// Called by the kiosk when the patient hits Cancel mid-capture. Doesn't
// stop the SDK directly here -- just flags the running runCapture loop,
// which stops the SDK itself on its next tick (within TICK_MS) and makes
// the pending /capture request resolve with a 499. Safe to call even if
// nothing is in flight (captureInFlight false), in which case it's a no-op.
app.post("/cancel", (req, res) => {
  if (!captureInFlight) {
    return res.json({ ok: true, wasCapturing: false });
  }
  cancelRequested = true;
  res.json({ ok: true, wasCapturing: true });
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