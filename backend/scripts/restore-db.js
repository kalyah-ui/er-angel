/**
 * Download a backup and verify it (SQLite integrity_check). Does NOT replace
 * the live database -- deploy/restore-db.sh does that, with the backend stopped.
 *
 *   node scripts/restore-db.js --list
 *   node scripts/restore-db.js latest|<key> <destination.db>
 */
import "dotenv/config";
import { downloadBackup, listBackups } from "../src/services/dbBackup.js";

const [which, dest] = process.argv.slice(2);
if (which === "--list") {
  const keys = await listBackups();
  console.log(keys.length ? keys.join("\n") : "(no backups yet)");
} else if (which && dest) {
  const { key, patients, readings } = await downloadBackup(which, dest);
  console.log(`[restore] ${key} -> ${dest}: integrity ok, ${patients} patients, ${readings} readings`);
} else {
  console.error("usage: node scripts/restore-db.js --list | latest|<key> <destination.db>");
  process.exit(1);
}
