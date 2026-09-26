import PatientCard from "./PatientCard.jsx";
import { parseUtc } from "../api/client.js";

const RISK_RANK = { high: 0, medium: 1, low: 2 };

export function riskOf(patient) {
  const level = String(patient.latest_alert?.risk_level ?? "").toLowerCase();
  return level in RISK_RANK ? level : "low";
}

function triageTime(patient) {
  return parseUtc(patient.baseline_reading?.created_at || patient.created_at)?.getTime() ?? Infinity;
}

// High risk first, then missed rechecks (nobody has eyes on them), then medium, then low.
function urgencyRank(patient) {
  const risk = riskOf(patient);
  if (risk === "high") return 0;
  if (patient.missed_recheck) return 1;
  return risk === "medium" ? 2 : 3;
}

// Most urgent first; within a rank, unacknowledged first, then longest wait.
function byUrgency(a, b) {
  const rank = urgencyRank(a) - urgencyRank(b);
  if (rank) return rank;
  const open = (p) => (p.latest_alert && !Number(p.latest_alert.acknowledged) ? 0 : 1);
  const ack = open(a) - open(b);
  if (ack) return ack;
  return triageTime(a) - triageTime(b);
}

// "Next up": the most urgent patient (highest risk, then longest wait) who
// hasn't been called to triage yet. A suggestion only -- the nurse clicks.
function nextUpId(patients) {
  const uncalled = patients.filter((p) => !p.last_called_at);
  uncalled.sort((a, b) => RISK_RANK[riskOf(a)] - RISK_RANK[riskOf(b)] || triageTime(a) - triageTime(b));
  return uncalled[0]?.id ?? null;
}

export default function PatientList({ patients, onAcknowledge, onCall }) {
  if (!patients.length) {
    return <p className="empty">No patients checked in yet.</p>;
  }

  const nextUp = nextUpId(patients);
  return (
    <div className="patient-grid">
      {[...patients].sort(byUrgency).map((p) => (
        <PatientCard
          key={p.id}
          patient={p}
          risk={riskOf(p)}
          nextUp={p.id === nextUp}
          onAcknowledge={onAcknowledge}
          onCall={onCall}
        />
      ))}
    </div>
  );
}
