import { db } from "../db/db.js";
import { insertReading, insertAlert } from "../services/recordReading.js";
import { createCall, markAnnounced } from "../services/calls.js";
import { toSqliteUtc } from "./sqliteTime.js";

// Alert text is pre-written (in the style Gemini produces) so Reset is
// instant and costs no Gemini quota. Only real kiosk rescans call Gemini.
function demoPatients() {
  return [
    {
      name: "Alex Chen",
      chief_complaint: "Mild chest tightness",
      // Fixed values (not read from test_output.json, which is a shared sample
      // that changes) so they always match the pre-written alert below.
      baseline: { heart_rate: 72, breathing_rate: 14, stress_score: 0.026, face_asymmetry_score: 0.0054 },
      rescan: { heart_rate: 110, breathing_rate: 15, stress_score: 0.030, face_asymmetry_score: 0.0061 },
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
      baseline: { heart_rate: 70, breathing_rate: 14, stress_score: 0.031, face_asymmetry_score: 0.0032 },
      rescan: { heart_rate: 88, breathing_rate: 19, stress_score: 0.036, face_asymmetry_score: 0.0035 },
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
      baseline: { heart_rate: 76, breathing_rate: 15, stress_score: 0.028, face_asymmetry_score: 0.0041 },
      // Checked in an hour ago and ignored both recheck reminders, so the
      // dashboard shows "Missed recheck" straight after a reset. The
      // reminders are pre-marked announced: the kiosk never plays them.
      checkedInMinutesAgo: 60,
      ignoredRemindersMinutesAgo: [25, 20],
    },
  ];
}

const minutesBefore = (now, minutes) => new Date(now.getTime() - minutes * 60000);

/**
 * Inserts the demo patients, baselines, rescans and pre-written alerts in
 * one transaction. Makes no Gemini calls. Returns a short summary per patient.
 *
 * Demo patients are flagged is_demo: they never get automatic recheck
 * reminders (only the kiosk's R key reminds them), and their recheck
 * countdown runs in real time, so Alex/Jordan show "Next recheck in 15/20 min"
 * and Sam shows "Missed recheck" -- predictable for a pitch.
 */
export const seedDemo = db.transaction((now = new Date()) => {
  const insertPatient = db.prepare("INSERT INTO patients (name, chief_complaint, is_demo, created_at) VALUES (?, ?, 1, ?)");

  return demoPatients().map((p) => {
    const checkedInAt = minutesBefore(now, p.checkedInMinutesAgo ?? 0);
    const patientId = insertPatient.run(p.name, p.chief_complaint, toSqliteUtc(checkedInAt)).lastInsertRowid;
    insertReading(patientId, { ...p.baseline, is_baseline: true }, checkedInAt);
    for (const minutesAgo of p.ignoredRemindersMinutesAgo ?? []) {
      markAnnounced(createCall(patientId, "recheck", minutesBefore(now, minutesAgo)).id);
    }
    if (!p.rescan) return { name: p.name, risk_level: null, reason_text: null };

    const reading = insertReading(patientId, { ...p.rescan, is_baseline: false }, now);
    const alert = insertAlert(patientId, reading.id, p.alert(`Patient ${patientId}`));
    return { name: p.name, risk_level: alert.risk_level, reason_text: alert.reason_text };
  });
});
