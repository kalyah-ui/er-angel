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

// Most urgent first; within a risk level, unacknowledged first, then longest wait.
function byUrgency(a, b) {
  const rank = RISK_RANK[riskOf(a)] - RISK_RANK[riskOf(b)];
  if (rank) return rank;
  const open = (p) => (p.latest_alert && !Number(p.latest_alert.acknowledged) ? 0 : 1);
  const ack = open(a) - open(b);
  if (ack) return ack;
  return triageTime(a) - triageTime(b);
}

export default function PatientList({ patients, onAcknowledge }) {
  if (!patients.length) {
    return <p className="empty">No patients checked in yet.</p>;
  }

  return (
    <div className="patient-grid">
      {[...patients].sort(byUrgency).map((p) => (
        <PatientCard key={p.id} patient={p} risk={riskOf(p)} onAcknowledge={onAcknowledge} />
      ))}
    </div>
  );
}
