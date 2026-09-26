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

const readingColumns = db.prepare("PRAGMA table_info(readings)").all();
if (!readingColumns.some((column) => column.name === "face_asymmetry_score")) {
	db.exec("ALTER TABLE readings ADD COLUMN face_asymmetry_score REAL");
}

console.log(`[db] ready at ${dbPath}`);
