/**
 * Voice prompts and PA announcements, sharing one audio channel.
 *
 * App.jsx calls playPrompt(screenName, context) on every screen change: it
 * stops whatever is playing, then speaks that screen's line (if it has one)
 * using ElevenLabs audio from the backend's POST /speak, falling back to the
 * browser's speechSynthesis if that fails. Never throws.
 *
 * playAnnouncement(text) says a PA line twice (see useAnnouncer.js). Screen
 * prompts don't cut an announcement off -- except the capture instructions,
 * which do; the announcer repeats it once the capture is over.
 *
 * Browsers block audio until the user interacts, so nothing plays until
 * unlockAudio() has run inside a tap/click/keypress (App wires this up).
 */
import { fetchSpeech } from "../api/client.js";
import { PROMPTS, FIXED_PROMPTS } from "./voiceLines.js";

const hasAudio = typeof Audio !== "undefined";
const hasSpeech = typeof window !== "undefined" && "speechSynthesis" in window;

// One reusable element: Safari only lets an element play after it has been
// started from a user gesture, so we unlock this one and keep using it.
const player = hasAudio ? new Audio() : null;
let unlocked = false;
// Bumped on every stop/play so a slow fetch for an old screen never plays.
let playbackId = 0;
// Resolves the in-progress playback wait early (with false) when stopped.
let cancelActive = null;
// A screen prompt is playing -- the announcer waits for it to finish.
let promptActive = false;
let announcing = false;
// text -> Promise<object URL>; failures are removed so they're retried later.
const audioUrls = new Map();

// ~0.1s of silence as a WAV, used to unlock the <audio> element.
function silentWavUrl() {
  const sampleRate = 8000;
  const samples = 800;
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const ascii = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([view.buffer], { type: "audio/wav" }));
}

function audioUrlFor(text) {
  if (!audioUrls.has(text)) {
    const pending = fetchSpeech(text).then((blob) => URL.createObjectURL(blob));
    audioUrls.set(text, pending);
    pending.catch(() => audioUrls.delete(text));
  }
  return audioUrls.get(text);
}

function pickBrowserVoice() {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("en"));
  return voices.find((v) => /natural|neural|aria|jenny|samantha|google us/i.test(v.name)) || voices[0] || null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Plays a URL on the shared element; resolves true when it ends, false if
// stopped first. Rejects if the browser refuses to play it.
function playUrlToEnd(url) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      player.removeEventListener("ended", onEnded);
      player.removeEventListener("error", onError);
      cancelActive = null;
    };
    const onEnded = () => {
      cleanup();
      resolve(true);
    };
    const onError = () => {
      cleanup();
      reject(new Error("audio playback error"));
    };
    player.addEventListener("ended", onEnded);
    player.addEventListener("error", onError);
    cancelActive = () => {
      cleanup();
      resolve(false);
    };
    player.src = url;
    player.play().catch((err) => {
      cleanup();
      reject(err);
    });
  });
}

// Browser speech fallback; resolves true when done, false if cancelled.
function speakWithBrowser(text) {
  if (!hasSpeech) return Promise.resolve(true);
  return new Promise((resolve) => {
    // Some browsers never fire onend -- don't let the announcer hang.
    const safety = setTimeout(() => done(true), 20000);
    const done = (value) => {
      clearTimeout(safety);
      cancelActive = null;
      resolve(value);
    };
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      const voice = pickBrowserVoice();
      if (voice) utterance.voice = voice;
      utterance.onend = () => done(true);
      utterance.onerror = () => done(false);
      cancelActive = () => done(false);
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn("[voice] browser speech failed:", err.message);
      done(true);
    }
  });
}

// Speaks one line to the end: ElevenLabs audio, else browser speech.
// Resolves true when finished, false if stopped/superseded.
async function speakToEnd(text, id) {
  try {
    const url = await audioUrlFor(text);
    if (id !== playbackId || !player) return false;
    return await playUrlToEnd(url);
  } catch (err) {
    // Superseded by a newer screen (the old play() is interrupted) -- stay quiet.
    if (id !== playbackId) return false;
    console.warn(`[voice] ElevenLabs audio unavailable (${err.message}) -- using browser speech`);
    return speakWithBrowser(text);
  }
}

/** Must run inside a user gesture (tap/click/key). Safe to call repeatedly. */
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;

  if (player) {
    player.src = silentWavUrl();
    player.play().catch(() => {});
  }
  if (hasSpeech) {
    // iOS needs one utterance started from a gesture before later ones are allowed.
    const warmup = new SpeechSynthesisUtterance(" ");
    warmup.volume = 0;
    window.speechSynthesis.speak(warmup);
  }

  // Fetch the fixed lines now so they're ready before they're needed.
  for (const name of FIXED_PROMPTS) audioUrlFor(PROMPTS[name]()).catch(() => {});
}

/** Stops any audio or browser speech that's playing. */
export function stopVoice() {
  playbackId++;
  promptActive = false;
  player?.pause();
  if (hasSpeech) window.speechSynthesis.cancel();
  cancelActive?.();
}

/** True while a screen prompt is playing. */
export function isPromptPlaying() {
  return promptActive;
}

// Mute (corner toggle, for a venue that's too loud or needs quiet). Kept in
// localStorage so it survives a kiosk reload; storage can be unavailable.
const MUTE_STORAGE_KEY = "er-angel-kiosk-muted";
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
})();

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  if (muted) stopVoice();
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
  } catch {
    // not persisted -- still muted for this session
  }
}

/** Stops the current line, then plays this screen's line, if it has one. */
export async function playPrompt(screenName, context = {}) {
  // Don't cut off a PA announcement for a screen change -- the screen's text
  // is visible anyway. The capture instructions are the exception.
  if (announcing && screenName !== "capture") return;

  stopVoice();
  const text = PROMPTS[screenName]?.(context);
  if (!text || !unlocked || muted) return;

  const id = playbackId;
  promptActive = true;
  await speakToEnd(text, id);
  if (id === playbackId) promptActive = false;
}

/**
 * Says a PA announcement `times` times with a pause between. Resolves true
 * once done (immediately if muted, or if audio isn't unlocked yet -- the
 * banner still shows), false if interrupted, e.g. by a capture starting.
 */
export async function playAnnouncement(text, { times = 2, pauseMs = 1500 } = {}) {
  if (!unlocked || muted) return true;

  stopVoice();
  const id = playbackId;
  announcing = true;
  try {
    for (let i = 0; i < times; i++) {
      if (i > 0) {
        await sleep(pauseMs);
        if (id !== playbackId) return false;
      }
      if (!(await speakToEnd(text, id))) return false;
    }
    return true;
  } finally {
    announcing = false;
  }
}
