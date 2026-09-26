// The one place to change capture length. Used for the real agent capture,
// the countdown ring, simulated captures (demo mode, D override, manual
// entry) and the "stay still" voice line, so the demo looks identical with or
// without the camera. No browser/Vite dependencies: backend scripts import it.
export const CAPTURE_SECONDS = 30;
