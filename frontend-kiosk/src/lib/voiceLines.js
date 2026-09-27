/**
 * What the kiosk says on each screen. Plain data with no browser/Vite
 * dependencies, so `npm run voice:warm` in backend/ can import the exact
 * same lines to pre-generate their audio.
 */
import { CAPTURE_SECONDS } from "./captureConfig.js";

export const PROMPTS = {
  // The welcome line plays right after the first tap on the welcome screen
  // (which opens the check-in form) -- before that tap, audio is blocked.
  checkin: () => "Welcome to E R Angel. Please enter your name, and tell us what brought you in today.",
  capture: () => `Please look at the camera and stay still for about ${CAPTURE_SECONDS} seconds.`,
  checkedIn: ({ patient }) => `You're checked in. You are patient number ${patient.id}. Please have a seat.`,
  thanks: () => "Thank you. Please have a seat.",
  frontDesk: () => "Sorry, something went wrong. Please see the front desk.",
  captureFailed: () => "We couldn't get a reading. Let's try again.",
};

// Lines that don't depend on the patient.
export const FIXED_PROMPTS = ["checkin", "capture", "thanks", "frontDesk", "captureFailed"];

// PA announcements, by call type. Patient NUMBER only -- never the name,
// on screen or in audio (privacy). `banner` is shown, `spoken` is said twice.
export const ANNOUNCEMENTS = {
  triage: {
    banner: (n) => `Patient #${n}, please come to the triage desk`,
    spoken: (n) => `Patient number ${n}, please come to the triage desk.`,
  },
  // Automatic, from the backend recheck scheduler.
  recheck: {
    banner: (n) => `Patient #${n}, please return to the check-in kiosk for a quick vitals check`,
    spoken: (n) => `Patient number ${n}, please return to the check-in kiosk for a quick vitals check.`,
  },
};
