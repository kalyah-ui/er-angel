/**
 * SQLite backups to Object Storage.
 *
 * Uses SQLite's online backup API (better-sqlite3 db.backup), which takes a
 * consistent snapshot while the app keeps reading and writing -- unlike
 * copying the file, which can catch it mid-write. Snapshots are gzipped and
 * uploaded as backups/sqlite/er-angel-<UTC timestamp>.db.gz; only the newest
 * KEEP_BACKUPS are kept.
 */
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import Database from "better-sqlite3";
import { db } from "../db/db.js";
import { objectStore } from "./objectStorage.js";

export const BACKUP_PREFIX = "backups/sqlite/";
export const KEEP_BACKUPS = 7;
const BACKUP_HOUR_UTC = Number(process.env.BACKUP_HOUR_UTC ?? 7); // 07:00 UTC = 3 AM Toronto (EDT)

/** e.g. backups/sqlite/er-angel-2026-09-27T070000Z.db.gz -- sorts by time. */
export function backupKey(date) {
  const stamp = date.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "");
  return `${BACKUP_PREFIX}er-angel-${stamp}.db.gz`;
}

const isBackupKey = (key) => key.startsWith(BACKUP_PREFIX) && key.endsWith(".db.gz");

function requireStore(store) {
  if (!store) throw new Error("Object Storage isn't configured (S3_* in .env)");
  return store;
}

export async function listBackups(store = objectStore()) {
  return (await requireStore(store).list(BACKUP_PREFIX)).filter(isBackupKey);
}

/**
 * Snapshot the live database, upload it, and prune to the newest KEEP_BACKUPS.
 * @returns {Promise<{ key: string, bytes: number, kept: string[], deleted: string[] }>}
 */
export async function backupDatabase({ now = new Date(), store = objectStore(), database = db } = {}) {
  requireStore(store);
  const tmp = path.join(os.tmpdir(), `er-angel-backup-${process.pid}-${Date.now()}.db`);
  try {
    await database.backup(tmp);
    const gz = zlib.gzipSync(fs.readFileSync(tmp));
    const key = backupKey(now);
    await store.put(key, gz, "application/gzip");

    const all = await listBackups(store);
    const deleted = all.slice(0, Math.max(0, all.length - KEEP_BACKUPS));
    await store.remove(deleted);
    return { key, bytes: gz.length, kept: all.slice(deleted.length), deleted };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * Download a backup ("latest" or a key) to `dest` and check it's a healthy
 * SQLite database. Doesn't touch the live database -- see deploy/restore-db.sh.
 * @returns {Promise<{ key: string, patients: number, readings: number }>}
 */
export async function downloadBackup(which, dest, store = objectStore()) {
  requireStore(store);
  const key = which === "latest" ? (await listBackups(store)).at(-1) : which;
  if (!key) throw new Error("No backups found in the bucket");
  const gz = await store.get(key);
  if (!gz) throw new Error(`Backup not found: ${key}`);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, zlib.gunzipSync(gz));

  const check = new Database(dest, { readonly: true });
  try {
    const integrity = check.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`Backup failed SQLite integrity_check: ${integrity}`);
    const count = (table) => check.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    return { key, patients: count("patients"), readings: count("readings") };
  } catch (err) {
    check.close();
    fs.rmSync(dest, { force: true });
    throw err;
  } finally {
    if (check.open) check.close();
  }
}

/** Nightly backup at BACKUP_HOUR_UTC while the backend runs (only if Object Storage is configured). */
export function startBackupScheduler() {
  if (!objectStore()) {
    console.log("[backup] Object Storage not configured -- nightly backups off");
    return () => {};
  }

  let timer;
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), BACKUP_HOUR_UTC));
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    timer = setTimeout(run, next - now);
    timer.unref?.();
    console.log(`[backup] next nightly backup at ${next.toISOString()}`);
  };
  const run = async () => {
    try {
      const { key, bytes, deleted } = await backupDatabase();
      console.log(`[backup] uploaded ${key} (${bytes} bytes)${deleted.length ? `, pruned ${deleted.length} old` : ""}`);
    } catch (err) {
      console.error("[backup] nightly backup FAILED:", err.message);
    }
    scheduleNext();
  };

  scheduleNext();
  return () => clearTimeout(timer);
}
