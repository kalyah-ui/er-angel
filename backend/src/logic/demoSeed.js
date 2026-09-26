import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../db/db.js";
import { insertReading, insertAlert } from "../services/recordReading.js";

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

// Alert text is pre-written (in the style Gemini produces) so Reset is
// instant and costs no Gemini quota. Only real kiosk rescans call Gemini.
function demoPatients() {
  return [
    {
      name: "Alex Chen",
      chief_complaint: "Mild chest tightness",
      // Baseline 72/14 is the one described in test_output.json's delta_summary.
      baseline: { heart_rate: 72, breathing_rate: 14, stress_score: null },
      rescan: mockRescan(),
      alert: (label) => ({
        risk_level: "high",
        delta_summary:
          "Heart rate increased from 72 to 110 bpm (+38, new tachycardia); respiratory rate stable (14 to 15 breaths/min).",
        reason_text: `${label}: HR up 38 bpm with chest tightness, get ECG and reassess immediately.`,
        recommended_action: "Immediate clinical re-evaluation and 12-lead ECG for new tachycardia with chest tightness.",
      }),
    },
    {
      name: "Jordan Smith",
      chief_complaint: "Twisted ankle, pain worsening",
      baseline: { heart_rate: 70, breathing_rate: 14, stress_score: null },
      rescan: { heart_rate: 88, breathing_rate: 19, stress_score: null },
      alert: (label) => ({
        risk_level: "medium",
        delta_summary:
          "Heart rate up 18 bpm (70 to 88) and respiratory rate up 5 breaths/min (14 to 19), consistent with worsening pain.",
        reason_text: `${label}: HR up 18 bpm, RR up 5 since triage, reassess pain.`,
        recommended_action: "Reassess pain level and consider analgesia; recheck vitals in 15 minutes.",
      }),
    },
    {
      name: "Sam Rivera",
      chief_complaint: "Sore throat",
      baseline: { heart_rate: 76, breathing_rate: 15, stress_score: null },
    },
  ];
}

/**
 * Inserts the demo patients, baselines, rescans and pre-written alerts in
 * one transaction. Makes no Gemini calls. Returns a short summary per patient.
 */
export const seedDemo = db.transaction(() => {
  const insertPatient = db.prepare("INSERT INTO patients (name, chief_complaint) VALUES (?, ?)");

  return demoPatients().map((p) => {
    const patientId = insertPatient.run(p.name, p.chief_complaint).lastInsertRowid;
    insertReading(patientId, { ...p.baseline, is_baseline: true });
    if (!p.rescan) return { name: p.name, risk_level: null, reason_text: null };

    const reading = insertReading(patientId, { ...p.rescan, is_baseline: false });
    const alert = insertAlert(patientId, reading.id, p.alert(`Patient ${patientId}`));
    return { name: p.name, risk_level: alert.risk_level, reason_text: alert.reason_text };
  });
});
