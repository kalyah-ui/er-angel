// SQLite's datetime('now') format: "YYYY-MM-DD HH:MM:SS", UTC, no zone marker.

export function toSqliteUtc(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function parseSqliteUtc(value) {
  if (!value) return null;
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
