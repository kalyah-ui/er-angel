/**
 * Voice prompts. App.jsx calls playPrompt(screenName, context) on every
 * screen change: it stops whatever is playing, then speaks that screen's
 * line (if it has one) using ElevenLabs audio from the backend's POST /speak,
 * falling back to the browser's speechSynthesis if that fails. Never throws.
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

function speakWithBrowser(text) {
  if (!hasSpeech) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    const voice = pickBrowserVoice();
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn("[voice] browser speech failed:", err.message);
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
  player?.pause();
  if (hasSpeech) window.speechSynthesis.cancel();
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
  stopVoice();
  const text = PROMPTS[screenName]?.(context);
  if (!text || !unlocked || muted) return;

  const id = playbackId;
  try {
    const url = await audioUrlFor(text);
    if (id !== playbackId || !player) return;
    player.src = url;
    await player.play();
  } catch (err) {
    // Superseded by a newer screen (the old play() is interrupted) -- stay quiet.
    if (id !== playbackId) return;
    console.warn(`[voice] ElevenLabs audio unavailable (${err.message}) -- using browser speech`);
    speakWithBrowser(text);
  }
}
