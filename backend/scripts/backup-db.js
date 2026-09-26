/**
 * Back up the SQLite database to Object Storage right now (same as the
 * nightly job): online snapshot, gzip, upload, keep the newest 7.
 *
 *   docker compose exec backend node scripts/backup-db.js
 */
import "dotenv/config";
import { backupDatabase, KEEP_BACKUPS } from "../src/services/dbBackup.js";

const { key, bytes, kept, deleted } = await backupDatabase();
console.log(`[backup] uploaded ${key} (${bytes} bytes)`);
if (deleted.length) console.log(`[backup] pruned ${deleted.length} older than the newest ${KEEP_BACKUPS}: ${deleted.join(", ")}`);
console.log(`[backup] ${kept.length} backup(s) in the bucket`);
