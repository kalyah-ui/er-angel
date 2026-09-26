import test from "node:test";
import assert from "node:assert";
import { callGemini } from "../src/services/geminiClient.js";

// `run` receives a real model object, but these stubs never touch the network:
// they record which model each attempt used and fail on cue.
function scripted(failures) {
  const calls = [];
  const run = async (model) => {
    calls.push(model.model.replace("models/", ""));
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
  assert.deepStrictEqual(calls, ["gemini-3.8-flash", "gemini-3.8-flash"]);
});

test("after 1 try + 2 retries on the primary, falls back to the second Flash model", async () => {
  const { calls, run } = scripted([http(503), timeout(), http(503)]);
  const started = Date.now();
  assert.strictEqual(await callGemini("test", {}, run), "ok");
  assert.deepStrictEqual(calls, ["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.7-flash"]);
  assert.ok(Date.now() - started >= 2900, "backs off ~1s then ~2s");
});

for (const status of [404, 429]) {
  test(`non-retryable ${status} skips straight to the fallback model`, async () => {
    const { calls, run } = scripted([http(status)]);
    assert.strictEqual(await callGemini("test", {}, run), "ok");
    assert.deepStrictEqual(calls, ["gemini-3.8-flash", "gemini-3.7-flash"]);
  });
}

test("throws once both models are exhausted so callers can use the rule-based fallback", async () => {
  const { calls, run } = scripted([http(503), http(503), http(503), http(503)]);
  await assert.rejects(callGemini("test", {}, run), /HTTP 503/);
  assert.strictEqual(calls.length, 4);
});
