import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../db/db.js";
import { recordReading } from "../services/recordReading.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_PATH = path.join(__dirname, "../../../test_output.json");

// The high-risk patient replays the rescan reading from test_output.json.
// The backend Docker image only contains backend/, so fall back to the same
// values if the file isn't there.
function mockRescan() {
  try {
    const { reading } = JSON.parse(fs.readFileSync(MOCK_PATH, "utf-8"));
    return {
      heart_rate: reading.heart_rate,
      breathing_rate: reading.breathing_rate,
      stress_score: reading.stress_score,
    };
  } catch {
    return { heart_rate: 110, breathing_rate: 15, stress_score: null };
  }
}

function demoPatients() {
  return [
    {
      name: "Alex Chen",
      chief_complaint: "Mild chest tightness",
      // Baseline 72/14 is the one described in test_output.json's delta_summary.
      baseline: { heart_rate: 72, breathing_rate: 14, stress_score: null },
      rescan: mockRescan(),
    },
    {
      name: "Jordan Smith",
      chief_complaint: "Twisted ankle, pain worsening",
      baseline: { heart_rate: 70, breathing_rate: 14, stress_score: null },
      rescan: { heart_rate: 88, breathing_rate: 19, stress_score: null },
    },
    {
      name: "Sam Rivera",
      chief_complaint: "Sore throat",
      baseline: { heart_rate: 76, breathing_rate: 15, stress_score: null },
    },
  ];
}

/**
 * Inserts the demo patients and their baselines, then runs each rescan
 * through the real reading pipeline (Gemini risk + alert line) in parallel.
 * Returns a short summary per patient.
 */
export async function seedDemo() {
  const insertPatient = db.prepare("INSERT INTO patients (name, chief_complaint) VALUES (?, ?)");

  // Check everyone in first so patient ids/triage order are deterministic.
  const seeded = [];
  for (const p of demoPatients()) {
    const info = insertPatient.run(p.name, p.chief_complaint);
    const patient = db.prepare("SELECT * FROM patients WHERE id = ?").get(info.lastInsertRowid);
    await recordReading(patient, { ...p.baseline, is_baseline: true });
    seeded.push({ patient, rescan: p.rescan });
  }

  return Promise.all(
    seeded.map(async ({ patient, rescan }) => {
      if (!rescan) return { name: patient.name, risk_level: null, reason_text: null };
      const { alert } = await recordReading(patient, { ...rescan, is_baseline: false });
      return { name: patient.name, risk_level: alert.risk_level, reason_text: alert.reason_text };
    })
  );
}
