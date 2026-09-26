import test, { beforeEach, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { synthesize, VoiceUnavailableError, voiceDisabledReason } from "../src/services/elevenLabsTts.js";

// Stub fetch so nothing reaches ElevenLabs (no characters spent).
const realFetch = globalThis.fetch;
let calls;
let respond;
globalThis.fetch = async (url, options) => {
  calls.push({ url, options });
  return respond();
};

const mp3 = (label) => () => new Response(Buffer.from(`fake-mp3-${label}`), { status: 200 });
const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/voice-cache");
const before = new Set(fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []);
// Unique per run so neither the disk cache nor earlier runs interfere.
const line = (name) => `test line ${name} ${process.pid}-${Date.now()}`;

beforeEach(() => {
  calls = [];
  respond = mp3("default");
  process.env.ELEVENLABS_API_KEY = "fake-key";
  delete process.env.ELEVENLABS_ENABLED;
});

after(() => {
  globalThis.fetch = realFetch;
  // Remove only the cache files these tests created.
  for (const f of fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []) {
    if (!before.has(f)) fs.unlinkSync(path.join(cacheDir, f));
  }
});

test("generates once, then serves repeat and concurrent requests from cache", async () => {
  const text = line("cache");
  const [a, b] = await Promise.all([synthesize(text), synthesize(text)]);
  const c = await synthesize(text);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(a.toString(), "fake-mp3-default");
  assert.ok(a.equals(b) && a.equals(c));

  const { url, options } = calls[0];
  assert.match(url, /\/v1\/text-to-speech\/EXAVITQu4vr4xnSDxMaL\?output_format=mp3_44100_128$/);
  assert.strictEqual(options.headers["xi-api-key"], "fake-key");
  assert.deepStrictEqual(
    { text: JSON.parse(options.body).text, model: JSON.parse(options.body).model_id },
    { text, model: "eleven_flash_v2_5" }
  );
});

test("ElevenLabs errors become VoiceUnavailableError with the reason, and aren't cached", async () => {
  const text = line("quota");
  respond = () =>
    new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "..." } }), { status: 401 });
  await assert.rejects(synthesize(text), (err) => {
    assert.ok(err instanceof VoiceUnavailableError);
    assert.strictEqual(err.message, "ElevenLabs HTTP 401 (quota_exceeded)");
    return true;
  });

  respond = mp3("retry");
  assert.strictEqual((await synthesize(text)).toString(), "fake-mp3-retry");
  assert.strictEqual(calls.length, 2);
});

test("network failures become VoiceUnavailableError", async () => {
  respond = () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(synthesize(line("network")), /network error: fetch failed/);
});

test("ELEVENLABS_ENABLED=false or a missing key never calls ElevenLabs", async () => {
  process.env.ELEVENLABS_ENABLED = "false";
  assert.strictEqual(voiceDisabledReason(), "ELEVENLABS_ENABLED=false");
  await assert.rejects(synthesize(line("off")), /ELEVENLABS_ENABLED=false/);

  delete process.env.ELEVENLABS_ENABLED;
  delete process.env.ELEVENLABS_API_KEY;
  await assert.rejects(synthesize(line("nokey")), /no ELEVENLABS_API_KEY set/);
  assert.strictEqual(calls.length, 0);
});
