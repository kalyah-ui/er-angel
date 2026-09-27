import {
  CAPTURE_DURATION_MS,
  CaptureCancelledError,
  cancelCapture,
  captureFromAgent,
  elevatedVitals,
  isAgentAvailable,
  mockVitals,
  normalizeVitals,
} from "./presage.js";

export { CaptureCancelledError };

// The agent was reachable but couldn't produce a reading (failed, timed out,
// or busy). The kiosk shows "We couldn't get a reading" with a retry button;
// nothing is stored.
export class CaptureFailedError extends Error {
  constructor(reason) {
    super(`capture failed: ${reason}`);
    this.name = "CaptureFailedError";
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Like sleep(), but rejects with CaptureCancelledError as soon as `signal`
// aborts, instead of always waiting out the full duration. Used for the
// manual/elevated/mock paths, which don't touch the network at all and so
// have nothing else that needs tearing down on cancel.
function sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CaptureCancelledError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new CaptureCancelledError());
      },
      { once: true }
    );
  });
}

/**
 * Gets vitals for one capture, in priority order:
 *   1. manual override (M panel)             -> typed values
 *   2. elevated override (D), rescans only   -> baseline + HR 35 / RR 5
 *   3. Presage agent, if reachable           -> real capture; if it fails,
 *      times out, or is busy: tell the agent to cancel (releases the camera)
 *      and throw CaptureFailedError -- never mock vitals for a real patient
 *   4. agent unreachable ("demo mode": a dev laptop with no agent)
 *                                            -> mock vitals near baseline
 *
 * `onStart(durationMs)` fires when the on-screen countdown should begin.
 *
 * `signal`, if provided, lets the caller cancel an in-progress capture --
 * acquireVitals throws CaptureCancelledError as soon as it fires, from
 * whichever branch is currently running. For the Presage path specifically,
 * aborting `signal` only tears down our own fetch; the agent is separately
 * told to stop via cancelCapture() so the SDK/camera actually releases
 * instead of continuing to run server-side after we've walked away.
 *
 * Resolves to { vitals, source } where source is
 * "manual" | "elevated" | "presage" | "mock".
 */
export async function acquireVitals({ mode, baseline, override, onStart, signal }) {
  if (signal?.aborted) throw new CaptureCancelledError();

  if (override?.type === "manual") {
    onStart(CAPTURE_DURATION_MS);
    await sleepAbortable(CAPTURE_DURATION_MS, signal);
    return { vitals: normalizeVitals(override), source: "manual" };
  }

  if (override?.type === "elevated" && mode === "rescan") {
    onStart(CAPTURE_DURATION_MS);
    await sleepAbortable(CAPTURE_DURATION_MS, signal);
    return { vitals: elevatedVitals(baseline), source: "elevated" };
  }

  if (await isAgentAvailable()) {
    if (signal?.aborted) throw new CaptureCancelledError();
    onStart(CAPTURE_DURATION_MS);
    try {
      return { vitals: await captureFromAgent({ signal }), source: "presage" };
    } catch (err) {
      // Whether the user cancelled, the kiosk timed out, or the agent failed:
      // aborting our own fetch only tears down the client side, so tell the
      // agent to stop too -- the SDK and camera must be released before the
      // next capture (otherwise it answers 409 busy). No-op if it's idle.
      cancelCapture();
      if (err instanceof CaptureCancelledError) throw err;
      console.warn(`[kiosk] Presage capture failed (${err.message}) -- asking the patient to try again`);
      throw new CaptureFailedError(err.message);
    }
  }

  console.warn("[kiosk] DEMO MODE: Presage agent unreachable -- using mock vitals");
  onStart(CAPTURE_DURATION_MS);
  await sleepAbortable(CAPTURE_DURATION_MS, signal);
  return { vitals: mockVitals(baseline), source: "mock" };
}