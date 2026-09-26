import { parseUtc } from "../api/client.js";

function formatValue(value) {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? String(Math.round(n)) : "—";
}

function formatDelta(baseline, latest) {
  if (!Number.isFinite(baseline) || !Number.isFinite(latest)) return null;
  const delta = Math.round(latest - baseline);
  if (delta === 0) return "±0";
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

function minutesSince(timestamp) {
  const date = parseUtc(timestamp);
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}

const VITALS = [
  { key: "heart_rate", label: "HR" },
  { key: "breathing_rate", label: "RR" },
  { key: "stress_score", label: "Stress" },
];

export default function PatientCard({ patient, risk, onAcknowledge }) {
  const baseline = patient.baseline_reading;
  // Until the first rescan, the latest reading *is* the baseline.
  const latest = patient.latest_reading && !Number(patient.latest_reading.is_baseline)
    ? patient.latest_reading
    : null;
  const alert = patient.latest_alert;
  const isOpen = Boolean(alert) && !Number(alert.acknowledged);
  const minutes = minutesSince(baseline?.created_at || patient.created_at);

  return (
    <article className={`patient-card risk-${risk}${risk === "high" && isOpen ? " pulse" : ""}`}>
      <div className="card-header">
        <div>
          <h2 className="patient-name">{patient.name}</h2>
          <p className="complaint">{patient.chief_complaint || "No complaint recorded"}</p>
        </div>
        <div className="card-header-right">
          <span className={`risk-pill risk-pill-${risk}`}>{risk.toUpperCase()}</span>
          <span className="wait-time">
            {minutes == null ? "—" : `${minutes} min`} since triage
          </span>
        </div>
      </div>

      {alert && (
        <div className="alert-block">
          <p className="reason">{alert.reason_text || "Alert received."}</p>
          {alert.recommended_action && <p className="action">{alert.recommended_action}</p>}
          {isOpen ? (
            <button className="ack-button" onClick={() => onAcknowledge(patient.id)}>
              Acknowledge
            </button>
          ) : (
            <p className="acked">✓ Acknowledged</p>
          )}
        </div>
      )}

      <table className="vitals">
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">Baseline</th>
            <th scope="col">Latest</th>
          </tr>
        </thead>
        <tbody>
          {VITALS.map(({ key, label }) => {
            const delta = formatDelta(baseline?.[key], latest?.[key]);
            return (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td>{formatValue(baseline?.[key])}</td>
                <td>
                  {formatValue(latest?.[key])}
                  {delta && <span className="delta"> ({delta})</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="units">HR in bpm · RR in breaths/min{latest ? "" : " · awaiting rescan"}</p>
    </article>
  );
}
