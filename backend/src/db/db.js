import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_URL || path.join(__dirname, "../../data/waitwatch.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

// Columns added after the first release: CREATE TABLE IF NOT EXISTS won't add
// them to an existing database, so add any that are missing.
const MIGRATIONS = [
  { table: "patients", column: "is_demo", ddl: "INTEGER NOT NULL DEFAULT 0" },
  { table: "readings", column: "face_asymmetry_score", ddl: "REAL" }, // Presage face landmarks (stroke screening)
];
for (const { table, column, ddl } of MIGRATIONS) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

console.log(`[db] ready at ${dbPath}`);
