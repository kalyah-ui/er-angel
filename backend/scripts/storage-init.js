/**
 * Object Storage setup + health check (safe to re-run):
 *   1. creates the bucket if it doesn't exist,
 *   2. does a write/read/delete round trip,
 *   3. uploads any voice-cache files on this server's disk that the bucket
 *      doesn't have yet (so a rebuilt server gets them without ElevenLabs).
 *
 *   docker compose exec backend node scripts/storage-init.js
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { objectStore } from "../src/services/objectStorage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOICE_CACHE_DIR = path.join(__dirname, "../data/voice-cache");

const store = objectStore();
if (!store) {
  console.error("[storage] S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY not set");
  process.exit(1);
}

const created = await store.ensureBucket();
console.log(`[storage] bucket "${store.bucket}" ${created ? "created" : "already exists"}`);

const key = `healthcheck/${Date.now()}.txt`;
await store.put(key, Buffer.from("ok"), "text/plain");
const back = (await store.get(key))?.toString();
await store.remove([key]);
if (back !== "ok") throw new Error(`round trip failed (read back ${JSON.stringify(back)})`);
console.log("[storage] write / read / delete round trip OK");

const local = fs.existsSync(VOICE_CACHE_DIR) ? fs.readdirSync(VOICE_CACHE_DIR).filter((f) => f.endsWith(".mp3")) : [];
const inBucket = new Set(await store.list("voice-cache/"));
const missing = local.filter((f) => !inBucket.has(`voice-cache/${f}`));
for (const f of missing) {
  await store.put(`voice-cache/${f}`, fs.readFileSync(path.join(VOICE_CACHE_DIR, f)), "audio/mpeg");
}
console.log(`[storage] voice cache: ${local.length} on disk, uploaded ${missing.length} missing -> bucket has ${inBucket.size + missing.length}`);
