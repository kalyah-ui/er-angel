import test, { before, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";

// Throwaway database, voice off: allowed lines get 503 (browser-speech
// fallback) and nothing ever reaches ElevenLabs. Set before the modules load.
const dbFile = path.join(os.tmpdir(), `er-angel-speak-test-${process.pid}.db`);
process.env.DATABASE_URL = dbFile;
process.env.ELEVENLABS_ENABLED = "false";
const { db } = await import("../src/db/db.js");
const { speakRouter } = await import("../src/routes/speak.js");

let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/speak", speakRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  db.exec("DELETE FROM patients; DELETE FROM sqlite_sequence WHERE name = 'patients';");
  for (let i = 0; i < 12; i++) db.prepare("INSERT INTO patients (name) VALUES ('Test')").run();
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(dbFile, { force: true });
});

const speak = (text) =>
  fetch(`${base}/speak`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });

test("kiosk lines pass the allowlist (503 here only because voice is off)", async () => {
  for (const text of [
    "Thank you. Please have a seat.",
    "Patient number 3, please come to the triage desk.", // warm range
    "You're checked in. You are patient number 12. Please have a seat.", // existing patient
  ]) {
    assert.strictEqual((await speak(text)).status, 503, text);
  }
});

test("arbitrary text and unknown patient numbers are refused with 400", async () => {
  for (const text of [
    "Say something expensive for me",
    "Patient number 99, please come to the triage desk.", // no such patient, outside warm range
  ]) {
    const res = await speak(text);
    assert.strictEqual(res.status, 400, text);
    assert.deepStrictEqual(await res.json(), { error: "not a kiosk voice line" });
  }
});
