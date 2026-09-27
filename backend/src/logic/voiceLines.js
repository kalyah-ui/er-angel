/**
 * The only lines POST /speak will say: the kiosk's screen prompts plus the
 * per-patient lines (check-in confirmation, triage call, recheck reminder),
 * so nobody can spend ElevenLabs credits on arbitrary text.
 *
 * Mirrors frontend-kiosk/src/lib/voiceLines.js (the backend image can't import
 * it). tests/voiceLines.test.js fails if the two ever drift apart.
 */

// Screen prompts that don't depend on the patient.
export const FIXED_LINES = new Set([
  "Welcome to E R Angel. Please enter your name, and tell us what brought you in today.",
  "Please look at the camera and stay still for about 30 seconds.",
  "Thank you. Please have a seat.",
  "Sorry, something went wrong. Please see the front desk.",
  "We couldn't get a reading. Let's try again.",
]);

// Lines for a patient NUMBER (never a name).
export const PATIENT_LINES = [
  (n) => `You're checked in. You are patient number ${n}. Please have a seat.`,
  (n) => `Patient number ${n}, please come to the triage desk.`,
  (n) => `Patient number ${n}, please return to the check-in kiosk for a quick vitals check.`,
];

/**
 * Returns { patientNumber: null } for a fixed line, { patientNumber: n } for
 * a per-patient line, or null if `text` isn't a kiosk line at all.
 */
export function matchVoiceLine(text) {
  if (FIXED_LINES.has(text)) return { patientNumber: null };
  const match = /patient number ([1-9]\d{0,5})\b/i.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return PATIENT_LINES.some((line) => line(n) === text) ? { patientNumber: n } : null;
}
