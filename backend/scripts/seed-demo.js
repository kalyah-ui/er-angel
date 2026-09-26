/**
 * Seeds the running backend with demo patients by going through the real
 * API (so alerts come from the live Gemini pipeline, not canned rows).
 *
 *   npm run seed              # backend must already be running
 *   API_URL=http://host:4000 npm run seed
 *
 * The high-risk patient replays the rescan reading from ../test_output.json.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const API_URL = process.env.API_URL || "http://localhost:4000";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mock = JSON.parse(fs.readFileSync(path.join(__dirname, "../../test_output.json"), "utf-8"));

async function post(route, body) {
  const res = await fetch(`${API_URL}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${route} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function addPatient({ name, chief_complaint, baseline, rescan }) {
  const patient = await post("/checkin", { name, chief_complaint });
  await post("/reading", { patient_id: patient.id, ...baseline, is_baseline: true });
  if (!rescan) return console.log(`  ${name}: baseline only`);

  const { alert } = await post("/reading", { patient_id: patient.id, ...rescan, is_baseline: false });
  console.log(`  ${name}: ${alert.risk_level} -- ${alert.reason_text}`);
}

await post("/admin/reset", { seed: false });
console.log(`Seeding ${API_URL}`);

// Baseline 72/14 is the one described in test_output.json's delta_summary.
await addPatient({
  name: "Alex Chen",
  chief_complaint: "Mild chest tightness",
  baseline: { heart_rate: 72, breathing_rate: 14, stress_score: null },
  rescan: {
    heart_rate: mock.reading.heart_rate,
    breathing_rate: mock.reading.breathing_rate,
    stress_score: mock.reading.stress_score,
  },
});

await addPatient({
  name: "Jordan Smith",
  chief_complaint: "Twisted ankle, pain worsening",
  baseline: { heart_rate: 70, breathing_rate: 14, stress_score: null },
  rescan: { heart_rate: 88, breathing_rate: 19, stress_score: null },
});

await addPatient({
  name: "Sam Rivera",
  chief_complaint: "Sore throat",
  baseline: { heart_rate: 76, breathing_rate: 15, stress_score: null },
});

console.log("Done.");
