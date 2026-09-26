-- WaitWatch schema. Kept intentionally minimal for a 24hr build.

CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  chief_complaint TEXT,
  triage_notes TEXT,           -- optional, filled by Gemini intake chatbot (stretch)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  heart_rate REAL,
  breathing_rate REAL,
  stress_score REAL,           -- optional, only if Presage tier exposes it
  face_asymmetry_score REAL,
  is_baseline INTEGER NOT NULL DEFAULT 0,  -- 1 = this is the triage baseline
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  reading_id INTEGER NOT NULL REFERENCES readings(id),
  risk_level TEXT NOT NULL,     -- 'low' | 'medium' | 'high'
  delta_summary TEXT,           -- structured summary from Gemini call 1
  reason_text TEXT,             -- nurse-facing one-liner from Gemini call 2
  recommended_action TEXT,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_readings_patient ON readings(patient_id);
CREATE INDEX IF NOT EXISTS idx_alerts_patient ON alerts(patient_id);
CREATE INDEX IF NOT EXISTS idx_alerts_ack ON alerts(acknowledged);
