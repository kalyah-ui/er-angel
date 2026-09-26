/**
 * One-time Object Storage setup + health check. Creates the bucket if it
 * doesn't exist, then does a write/read/delete round trip.
 *
 *   docker compose exec backend node scripts/storage-init.js
 */
import "dotenv/config";
import { objectStore } from "../src/services/objectStorage.js";

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
