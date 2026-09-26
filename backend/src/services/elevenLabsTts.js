import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isFlagDisabled } from "../logic/envFlags.js";

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

// text -> Promise<Buffer>. Holds finished audio and in-flight generations, so
// concurrent requests for the same line share a single ElevenLabs call.
const memoryCache = new Map();

export class VoiceUnavailableError extends Error {}

export function voiceDisabledReason() {
  if (isFlagDisabled("ELEVENLABS_ENABLED")) return "ELEVENLABS_ENABLED=false";
  if (!process.env.ELEVENLABS_API_KEY) return "no ELEVENLABS_API_KEY set";
  return null;
}

// Voice/model are part of the key, so changing either regenerates audio.
function cacheFile(text) {
  const hash = crypto
    .createHash("sha256")
    .update(`${VOICE_ID}|${MODEL_ID}|${OUTPUT_FORMAT}|${text}`)
    .digest("hex")
    .slice(0, 32);
  return path.join(CACHE_DIR, `${hash}.mp3`);
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
 * MP3 audio for `text`: memory cache -> disk cache -> ElevenLabs (once per
 * line, ever). Throws VoiceUnavailableError when disabled or on any failure.
 */
export async function synthesize(text) {
  const disabled = voiceDisabledReason();
  if (disabled) throw new VoiceUnavailableError(disabled);

  if (!memoryCache.has(text)) {
    const pending = (async () => {
      const file = cacheFile(text);
      try {
        return await fs.promises.readFile(file);
      } catch {
        // not cached on disk yet
      }

      const audio = await generate(text);
      console.log(`[voice] generated ${text.length} chars via ElevenLabs: "${text}"`);
      await fs.promises.mkdir(CACHE_DIR, { recursive: true });
      await fs.promises.writeFile(file, audio);
      return audio;
    })();

    memoryCache.set(text, pending);
    // Don't cache failures -- the next request should try again.
    pending.catch(() => memoryCache.delete(text));
  }

  return memoryCache.get(text);
}
