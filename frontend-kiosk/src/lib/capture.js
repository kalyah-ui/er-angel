import {
  CAPTURE_DURATION_MS,
  captureFromAgent,
  elevatedVitals,
  isAgentAvailable,
  mockVitals,
  normalizeVitals,
} from "./presage.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gets vitals for one capture, in priority order:
 *   1. manual override (M panel)             -> typed values
 *   2. elevated override (D), rescans only   -> baseline + HR 35 / RR 5
 *   3. Presage agent, if reachable           -> real capture
 *   4. otherwise ("demo mode")               -> mock vitals near baseline
 *
 * `onStart(durationMs)` fires when the on-screen countdown should begin.
 * Resolves to { vitals, source } where source is
 * "manual" | "elevated" | "presage" | "mock".
 */
export async function acquireVitals({ mode, baseline, override, onStart }) {
  if (override?.type === "manual") {
    onStart(CAPTURE_DURATION_MS);
    await sleep(CAPTURE_DURATION_MS);
    return { vitals: normalizeVitals(override), source: "manual" };
  }

  if (override?.type === "elevated" && mode === "rescan") {
    onStart(CAPTURE_DURATION_MS);
    await sleep(CAPTURE_DURATION_MS);
    return { vitals: elevatedVitals(baseline), source: "elevated" };
  }

  if (await isAgentAvailable()) {
    onStart(CAPTURE_DURATION_MS);
    try {
      return { vitals: await captureFromAgent(), source: "presage" };
    } catch (err) {
      console.warn(`[kiosk] DEMO MODE: Presage capture failed (${err.message}) -- using mock vitals`);
      return { vitals: mockVitals(baseline), source: "mock" };
    }
  }

  console.warn("[kiosk] DEMO MODE: Presage agent unreachable -- using mock vitals");
  onStart(CAPTURE_DURATION_MS);
  await sleep(CAPTURE_DURATION_MS);
  return { vitals: mockVitals(baseline), source: "mock" };
}
