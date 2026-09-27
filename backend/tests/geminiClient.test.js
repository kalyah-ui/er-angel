import test, { beforeEach } from "node:test";
import assert from "node:assert";
import { callGemini, geminiDisabledReason, GeminiCapError, resetGeminiCallCount } from "../src/services/geminiClient.js";
import { classifyRisk } from "../src/services/geminiRisk.js";

// Fake keys: these stubs never touch the network.
beforeEach(() => {
  process.env.GEMINI_API_KEY = "key-one";
  delete process.env.GEMINI_API_KEY_2;
  delete process.env.GEMINI_ENABLED;
});

// `run` receives a real model object; record which model + key each attempt
// used and fail on cue.
function scripted(failures) {
  const calls = [];
  const run = async (model) => {
    calls.push(`${model.model.replace("models/", "")} ${model.apiKey}`);
    const failure = failures[calls.length - 1];
    if (failure) throw failure;
    return "ok";
  };
  return { calls, run };
}

const http = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
const timeout = () => new Error("This operation was aborted");

test("retries a 503 on the primary model, then succeeds", async () => {
  const { calls, run } = scripted([http(503)]);
  assert.strictEqual(await callGemini("test", {}, run), "ok");
  assert.deepStrictEqual(calls, ["gemini-3.8-flash key-one", "gemini-3.8-flash key-one"]);
});

test("after 1 try + 2 retries on the primary, falls back to the second Flash model", async () => {
  const { calls, run } = scripted([http(503), timeout(), http(503)]);
  const started = Date.now();
  assert.strictEqual(await callGemini("test", {}, run), "ok");
  assert.deepStrictEqual(calls, [
    "gemini-3.8-flash key-one",
    "gemini-3.8-flash key-one",
    "gemini-3.8-flash key-one",
    "gemini-3.7-flash key-one",
  ]);
  assert.ok(Date.now() - started >= 2900, "backs off ~1s then ~2s");
});

for (const status of [404, 429]) {
  test(`with one key, a ${status} skips straight to the fallback model`, async () => {
    const { calls, run } = scripted([http(status)]);
    assert.strictEqual(await callGemini("test", {}, run), "ok");
    assert.deepStrictEqual(calls, ["gemini-3.8-flash key-one", "gemini-3.7-flash key-one"]);
  });
}

test("a 429 on key 1 switches to GEMINI_API_KEY_2 on the same model first", async () => {
  process.env.GEMINI_API_KEY_2 = "key-two";
  const { calls, run } = scripted([http(429)]);
  assert.strictEqual(await callGemini("test", {}, run), "ok");
  assert.deepStrictEqual(calls, ["gemini-3.8-flash key-one", "gemini-3.8-flash key-two"]);
});

test("429 on both keys moves to the fallback model, again trying key 1 then key 2", async () => {
  process.env.GEMINI_API_KEY_2 = "key-two";
  const { calls, run } = scripted([http(429), http(429), http(429)]);
  assert.strictEqual(await callGemini("test", {}, run), "ok");
  assert.deepStrictEqual(calls, [
    "gemini-3.8-flash key-one",
    "gemini-3.8-flash key-two",
    "gemini-3.7-flash key-one",
    "gemini-3.7-flash key-two",
  ]);
});

test("a 503 is a capacity problem, not a key problem: it doesn't switch keys", async () => {
  process.env.GEMINI_API_KEY_2 = "key-two";
  const { calls, run } = scripted([http(503), http(503), http(503)]);
  assert.strictEqual(await callGemini("test", {}, run), "ok");
  assert.deepStrictEqual(calls, [
    "gemini-3.8-flash key-one",
    "gemini-3.8-flash key-one",
    "gemini-3.8-flash key-one",
    "gemini-3.7-flash key-one",
  ]);
});

test("throws once both models are exhausted so callers can use the rule-based fallback", async () => {
  const { calls, run } = scripted([http(503), http(503), http(503), http(503)]);
  await assert.rejects(callGemini("test", {}, run), /HTTP 503/);
  assert.strictEqual(calls.length, 4);
});

test("GEMINI_ENABLED=false (and 0/no/off) disables Gemini; unset or true enables it", () => {
  for (const value of ["false", "FALSE", "0", "no", "off"]) {
    process.env.GEMINI_ENABLED = value;
    assert.strictEqual(geminiDisabledReason(), "GEMINI_ENABLED=false", value);
  }
  for (const value of [undefined, "", "true", "1"]) {
    if (value === undefined) delete process.env.GEMINI_ENABLED;
    else process.env.GEMINI_ENABLED = value;
    assert.strictEqual(geminiDisabledReason(), null, String(value));
  }
  delete process.env.GEMINI_API_KEY;
  assert.strictEqual(geminiDisabledReason(), "no GEMINI_API_KEY set");
});

test("classifyRisk with GEMINI_ENABLED=false returns the rule-based result without calling Gemini", async () => {
  process.env.GEMINI_ENABLED = "false";
  const started = Date.now();
  const result = await classifyRisk({
    baseline: { heart_rate: 72, breathing_rate: 14 },
    current: { heart_rate: 110, breathing_rate: 15 },
    chiefComplaint: "Mild chest tightness",
    minutesElapsed: 20,
  });
  assert.strictEqual(result.risk_level, "high");
  assert.strictEqual(result.delta_summary, "HR up 38 bpm, RR up 1 breaths/min since triage.");
  assert.ok(Date.now() - started < 100, "no network call");
});

test("hourly cap: stops calling Gemini once GEMINI_MAX_CALLS_PER_HOUR attempts are used", async () => {
  resetGeminiCallCount();
  process.env.GEMINI_MAX_CALLS_PER_HOUR = "2";
  try {
    const { calls, run } = scripted([]);
    assert.strictEqual(await callGemini("test", {}, run), "ok");
    assert.strictEqual(await callGemini("test", {}, run), "ok");
    assert.match(geminiDisabledReason(), /hourly cap/);
    await assert.rejects(callGemini("test", {}, run), GeminiCapError);
    assert.strictEqual(calls.length, 2, "no third request reached Gemini");
  } finally {
    delete process.env.GEMINI_MAX_CALLS_PER_HOUR;
    resetGeminiCallCount();
  }
});

test("hourly cap: retries count toward it, and 0 means rule-based only", async () => {
  resetGeminiCallCount();
  process.env.GEMINI_MAX_CALLS_PER_HOUR = "1";
  try {
    const { calls, run } = scripted([http(503)]);
    await assert.rejects(callGemini("test", {}, run), GeminiCapError);
    assert.strictEqual(calls.length, 1, "the retry was not sent");
    process.env.GEMINI_MAX_CALLS_PER_HOUR = "0";
    resetGeminiCallCount();
    assert.match(geminiDisabledReason(), /hourly cap/);
  } finally {
    delete process.env.GEMINI_MAX_CALLS_PER_HOUR;
    resetGeminiCallCount();
  }
});
