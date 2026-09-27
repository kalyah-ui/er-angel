import { Router } from "express";
import { db } from "../db/db.js";
import { synthesizeWithSource, MAX_TEXT_LENGTH, VoiceUnavailableError } from "../services/elevenLabsTts.js";
import { matchVoiceLine } from "../logic/voiceLines.js";

export const speakRouter = Router();

// Patient numbers `npm run voice:warm` pre-generates announcements for, so
// they're allowed before those patients exist. Any other number must be a
// real patient -- that keeps the set of lines (and ElevenLabs spend) bounded.
const WARM_PATIENT_NUMBERS = 10;

function patientNumberAllowed(n) {
  return n <= WARM_PATIENT_NUMBERS || Boolean(db.prepare("SELECT 1 FROM patients WHERE id = ?").get(n));
}

// POST /speak { text } -> audio/mpeg, with X-Voice-Source: memory|disk|bucket|elevenlabs
// Only the kiosk's own voice lines (logic/voiceLines.js) are accepted: 400 otherwise.
// 503 { error, reason } when voice is off or ElevenLabs fails; the kiosk then
// falls back to the browser's speechSynthesis. The API key never leaves the backend.
speakRouter.post("/", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `text must be at most ${MAX_TEXT_LENGTH} characters` });
  }
  const line = matchVoiceLine(text);
  if (!line || (line.patientNumber != null && !patientNumberAllowed(line.patientNumber))) {
    return res.status(400).json({ error: "not a kiosk voice line" });
  }

  try {
    const { audio, source } = await synthesizeWithSource(text);
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audio.length,
      "Cache-Control": "public, max-age=86400",
      "X-Voice-Source": source,
    });
    res.send(audio);
  } catch (err) {
    if (!(err instanceof VoiceUnavailableError)) console.error("[voice] unexpected error:", err);
    const reason = err instanceof VoiceUnavailableError ? err.message : "internal error";
    console.warn(`[voice] FALLBACK: ${reason} -- kiosk will use browser speech for "${text}"`);
    res.status(503).json({ error: "voice unavailable", reason });
  }
});
