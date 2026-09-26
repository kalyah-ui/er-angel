import { Router } from "express";
import { synthesize, MAX_TEXT_LENGTH, VoiceUnavailableError } from "../services/elevenLabsTts.js";

export const speakRouter = Router();

// POST /speak { text } -> audio/mpeg
// 503 { error, reason } when voice is off or ElevenLabs fails; the kiosk then
// falls back to the browser's speechSynthesis. The API key never leaves the backend.
speakRouter.post("/", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) return res.status(400).json({ error: "text is required" });
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `text must be at most ${MAX_TEXT_LENGTH} characters` });
  }

  try {
    const audio = await synthesize(text);
    res.set({ "Content-Type": "audio/mpeg", "Content-Length": audio.length, "Cache-Control": "public, max-age=86400" });
    res.send(audio);
  } catch (err) {
    if (!(err instanceof VoiceUnavailableError)) console.error("[voice] unexpected error:", err);
    const reason = err instanceof VoiceUnavailableError ? err.message : "internal error";
    console.warn(`[voice] FALLBACK: ${reason} -- kiosk will use browser speech for "${text}"`);
    res.status(503).json({ error: "voice unavailable", reason });
  }
});
