import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isFlagDisabled } from "../logic/envFlags.js";
import { objectStore } from "./objectStorage.js";

// ---- Voice settings: change these to try a different voice/model ----------
// "Sarah" -- premade ElevenLabs voice (soft, warm, reassuring); premade voices
// work on the free tier.
export const VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
// Flash v2.5: ElevenLabs' lowest-latency model.
export const MODEL_ID = "eleven_flash_v2_5";
const OUTPUT_FORMAT = "mp3_44100_128";
// Higher stability = calmer, more even delivery.
const VOICE_SETTINGS = { stability: 0.7, similarity_boost: 0.75, style: 0, use_speaker_boost: true };
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 10000;
export const MAX_TEXT_LENGTH = 400;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "../../data/voice-cache");

// text -> Promise<{ audio, source }>. Holds finished audio and in-flight
// lookups, so concurrent requests for the same line share one ElevenLabs call.
const memoryCache = new Map();

export class VoiceUnavailableError extends Error {}

export function voiceDisabledReason() {
  if (isFlagDisabled("ELEVENLABS_ENABLED")) return "ELEVENLABS_ENABLED=false";
  if (!process.env.ELEVENLABS_API_KEY) return "no ELEVENLABS_API_KEY set";
  return null;
}

// Voice/model are part of the key, so changing either regenerates audio.
function cacheName(text) {
  const hash = crypto
    .createHash("sha256")
    .update(`${VOICE_ID}|${MODEL_ID}|${OUTPUT_FORMAT}|${text}`)
    .digest("hex")
    .slice(0, 32);
  return `${hash}.mp3`;
}

function cacheFile(text) {
  return path.join(CACHE_DIR, cacheName(text));
}

// Same file name in the bucket, under voice-cache/.
const bucketKey = (text) => `voice-cache/${cacheName(text)}`;

async function writeDisk(text, audio) {
  await fs.promises.mkdir(CACHE_DIR, { recursive: true });
  await fs.promises.writeFile(cacheFile(text), audio);
}

// Bucket problems never break speech: a failed read falls through to
// ElevenLabs, a failed upload just means the next server regenerates it.
async function readBucket(store, text) {
  try {
    return await store.get(bucketKey(text));
  } catch (err) {
    console.warn(`[voice] bucket read failed (${err.message}) -- trying ElevenLabs`);
    return null;
  }
}

async function uploadBucket(store, text, audio) {
  try {
    await store.put(bucketKey(text), audio, "audio/mpeg");
  } catch (err) {
    console.warn(`[voice] bucket upload failed (${err.message}) -- kept on disk only`);
  }
}

export function isCachedOnDisk(text) {
  return fs.existsSync(cacheFile(text));
}

async function generate(text) {
  let res;
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
  } catch (err) {
    throw new VoiceUnavailableError(`network error: ${err.message}`);
  }

  if (!res.ok) {
    // ElevenLabs errors look like { detail: { status: "quota_exceeded", message } }
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.detail?.status || body?.detail?.message || JSON.stringify(body).slice(0, 200);
    } catch {
      // non-JSON error body
    }
    throw new VoiceUnavailableError(`ElevenLabs HTTP ${res.status}${detail ? ` (${detail})` : ""}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * MP3 audio for `text` and where it came from: memory -> disk -> bucket
 * (Object Storage, if configured) -> ElevenLabs. New audio is saved to disk
 * and uploaded to the bucket, so each line is generated once, ever -- even
 * across server rebuilds. Throws VoiceUnavailableError when disabled or when
 * ElevenLabs is needed and fails.
 *
 * @returns {Promise<{ audio: Buffer, source: "memory"|"disk"|"bucket"|"elevenlabs" }>}
 */
export async function synthesizeWithSource(text) {
  const disabled = voiceDisabledReason();
  if (disabled) throw new VoiceUnavailableError(disabled);

  if (memoryCache.has(text)) {
    const { audio } = await memoryCache.get(text);
    return { audio, source: "memory" };
  }

  const pending = (async () => {
    try {
      return { audio: await fs.promises.readFile(cacheFile(text)), source: "disk" };
    } catch {
      // not cached on disk yet
    }

    const store = objectStore();
    const fromBucket = store && (await readBucket(store, text));
    if (fromBucket) {
      await writeDisk(text, fromBucket);
      return { audio: fromBucket, source: "bucket" };
    }

    const audio = await generate(text);
    console.log(`[voice] generated ${text.length} chars via ElevenLabs: "${text}"`);
    await writeDisk(text, audio);
    if (store) await uploadBucket(store, text, audio);
    return { audio, source: "elevenlabs" };
  })();

  memoryCache.set(text, pending);
  // Don't cache failures -- the next request should try again.
  pending.catch(() => memoryCache.delete(text));
  return pending;
}

/** MP3 audio for `text` (see synthesizeWithSource). */
export async function synthesize(text) {
  return (await synthesizeWithSource(text)).audio;
}
