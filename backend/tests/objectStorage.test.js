import test, { beforeEach, after } from "node:test";
import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

// Throwaway database -- must be set before db.js is imported.
const dbFile = path.join(os.tmpdir(), `er-angel-storage-test-${process.pid}.db`);
process.env.DATABASE_URL = dbFile;
process.env.GEMINI_ENABLED = "false";
const { db } = await import("../src/db/db.js");
const { setObjectStoreForTests } = await import("../src/services/objectStorage.js");
const { synthesizeWithSource } = await import("../src/services/elevenLabsTts.js");
const { backupDatabase, backupKey, downloadBackup, KEEP_BACKUPS } = await import("../src/services/dbBackup.js");

// In-memory stand-in for the S3 bucket.
function fakeStore({ failReads = false } = {}) {
  const objects = new Map();
  return {
    objects,
    bucket: "test-bucket",
    async get(key) {
      if (failReads) throw new Error("bucket unreachable");
      return objects.get(key) ?? null;
    },
    async put(key, body) {
      objects.set(key, Buffer.from(body));
    },
    async list(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    async remove(keys) {
      for (const k of keys) objects.delete(k);
    },
  };
}

// ElevenLabs stub.
const realFetch = globalThis.fetch;
let elevenLabsCalls = 0;
globalThis.fetch = async () => {
  elevenLabsCalls++;
  return new Response(Buffer.from("fresh-mp3"), { status: 200 });
};

const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../data/voice-cache");
const before = new Set(fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []);
const line = (name) => `storage test ${name} ${process.pid}-${Date.now()}-${Math.random()}`;

beforeEach(() => {
  elevenLabsCalls = 0;
  process.env.ELEVENLABS_API_KEY = "fake-key";
  delete process.env.ELEVENLABS_ENABLED;
  db.exec("DELETE FROM calls; DELETE FROM alerts; DELETE FROM readings; DELETE FROM patients;");
});

after(() => {
  setObjectStoreForTests(undefined);
  globalThis.fetch = realFetch;
  for (const f of fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : []) {
    if (!before.has(f)) fs.unlinkSync(path.join(cacheDir, f));
  }
  db.close();
  fs.rmSync(dbFile, { force: true });
});

// ---------- voice cache: memory -> disk -> bucket -> ElevenLabs ----------

test("new audio is generated once, saved to disk and uploaded to the bucket", async () => {
  const store = fakeStore();
  setObjectStoreForTests(store);
  const text = line("upload");

  const first = await synthesizeWithSource(text);
  assert.deepStrictEqual([first.source, first.audio.toString(), elevenLabsCalls], ["elevenlabs", "fresh-mp3", 1]);
  const [key] = [...store.objects.keys()];
  assert.match(key, /^voice-cache\/[0-9a-f]{32}\.mp3$/);
  assert.strictEqual(store.objects.get(key).toString(), "fresh-mp3");

  assert.strictEqual((await synthesizeWithSource(text)).source, "memory");
  assert.strictEqual(elevenLabsCalls, 1);
});

test("a fresh server (empty disk) gets audio from the bucket, not ElevenLabs", async () => {
  const store = fakeStore();
  setObjectStoreForTests(store);
  const text = line("rebuild");
  await synthesizeWithSource(text); // "old server" generated + uploaded it
  const [key] = [...store.objects.keys()];
  store.objects.set(key, Buffer.from("from-bucket"));

  // Simulate the rebuilt server: same bucket, nothing on disk or in memory.
  fs.unlinkSync(path.join(cacheDir, key.slice("voice-cache/".length)));
  const { synthesizeWithSource: freshSynthesize } = await import(`../src/services/elevenLabsTts.js?fresh=${Date.now()}`);
  elevenLabsCalls = 0;
  const got = await freshSynthesize(text);
  assert.deepStrictEqual([got.source, got.audio.toString(), elevenLabsCalls], ["bucket", "from-bucket", 0]);
  assert.ok(fs.existsSync(path.join(cacheDir, key.slice("voice-cache/".length))), "bucket hit is saved to disk");
});

test("bucket outage never breaks speech: falls through to ElevenLabs", async () => {
  setObjectStoreForTests(fakeStore({ failReads: true }));
  const got = await synthesizeWithSource(line("outage"));
  assert.deepStrictEqual([got.source, elevenLabsCalls], ["elevenlabs", 1]);
});

test("without Object Storage configured, behaves exactly as before (disk only)", async () => {
  setObjectStoreForTests(null);
  const text = line("nostore");
  assert.strictEqual((await synthesizeWithSource(text)).source, "elevenlabs");
});

// ---------- SQLite backups ----------

function addPatients(n) {
  for (let i = 0; i < n; i++) db.prepare("INSERT INTO patients (name) VALUES (?)").run(`Backup Patient ${i}`);
}

test("backup key has the UTC date and time, sortable", () => {
  assert.strictEqual(backupKey(new Date("2026-09-27T07:00:05.123Z")), "backups/sqlite/er-angel-2026-09-27T070005Z.db.gz");
});

test("backup is a consistent gzipped SQLite snapshot that restores to the same data", async () => {
  const store = fakeStore();
  addPatients(3);
  const { key, bytes } = await backupDatabase({ now: new Date("2026-09-27T07:00:00Z"), store });
  assert.strictEqual(key, "backups/sqlite/er-angel-2026-09-27T070000Z.db.gz");
  assert.ok(bytes > 0 && zlib.gunzipSync(store.objects.get(key)).subarray(0, 15).toString() === "SQLite format 3");

  addPatients(2); // changes after the backup must not appear in the restore
  const dest = path.join(os.tmpdir(), `er-angel-restore-test-${process.pid}.db`);
  const restored = await downloadBackup("latest", dest, store);
  assert.deepStrictEqual(restored, { key, patients: 3, readings: 0 });
  fs.rmSync(dest, { force: true });
});

test(`keeps only the newest ${KEEP_BACKUPS} backups`, async () => {
  const store = fakeStore();
  store.objects.set("voice-cache/keep-me.mp3", Buffer.from("x")); // other prefixes untouched
  for (let day = 1; day <= 9; day++) {
    await backupDatabase({ now: new Date(Date.UTC(2026, 8, day, 7)), store });
  }
  const backups = await store.list("backups/sqlite/");
  assert.strictEqual(backups.length, KEEP_BACKUPS);
  assert.strictEqual(backups[0], "backups/sqlite/er-angel-2026-09-03T070000Z.db.gz");
  assert.strictEqual(backups.at(-1), "backups/sqlite/er-angel-2026-09-09T070000Z.db.gz");
  assert.ok(store.objects.has("voice-cache/keep-me.mp3"));
});

test("restore refuses a corrupt backup and leaves nothing behind", async () => {
  const store = fakeStore();
  store.objects.set("backups/sqlite/er-angel-2026-09-27T070000Z.db.gz", zlib.gzipSync(Buffer.from("not a database")));
  const dest = path.join(os.tmpdir(), `er-angel-corrupt-test-${process.pid}.db`);
  await assert.rejects(downloadBackup("latest", dest, store));
  assert.strictEqual(fs.existsSync(dest), false);
});

test("restore picks the newest backup for 'latest'", async () => {
  const store = fakeStore();
  addPatients(1);
  await backupDatabase({ now: new Date("2026-09-25T07:00:00Z"), store });
  addPatients(1);
  await backupDatabase({ now: new Date("2026-09-26T07:00:00Z"), store });
  const dest = path.join(os.tmpdir(), `er-angel-latest-test-${process.pid}.db`);
  const got = await downloadBackup("latest", dest, store);
  assert.deepStrictEqual([got.key.endsWith("2026-09-26T070000Z.db.gz"), got.patients], [true, 2]);
  fs.rmSync(dest, { force: true });
});
