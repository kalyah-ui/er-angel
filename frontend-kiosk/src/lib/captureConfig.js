// The one place to change capture timing. Used for the real agent capture,
// the countdown ring, simulated captures (demo mode, D override, manual
// entry) and the "stay still" voice line, so the demo looks identical with or
// without the camera. No browser/Vite dependencies: backend scripts import it.
export const CAPTURE_SECONDS = 30;

// The Presage agent keeps capturing while framing is poor (the countdown
// pauses) for up to CAPTURE_SECONDS x this in total, then stops with partial
// data. MUST match MAX_WALL_CLOCK_MULTIPLIER in presage-agent/src/index.js.
export const AGENT_MAX_WALL_CLOCK_MULTIPLIER = 3;
export const AGENT_MAX_CAPTURE_SECONDS = CAPTURE_SECONDS * AGENT_MAX_WALL_CLOCK_MULTIPLIER; // 90

// The kiosk waits this much longer than the agent's maximum before giving up
// (the agent needs a moment to stop the SDK and compute the result).
export const CAPTURE_TIMEOUT_MARGIN_SECONDS = 10;
export const KIOSK_CAPTURE_TIMEOUT_SECONDS = AGENT_MAX_CAPTURE_SECONDS + CAPTURE_TIMEOUT_MARGIN_SECONDS; // 100
