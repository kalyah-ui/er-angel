import { parseUtc } from "../api/client.js";

function formatValue(value, digits = 0) {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function formatDelta(baseline, latest, digits = 0) {
  if (!Number.isFinite(baseline) || !Number.isFinite(latest)) return null;
  const delta = Number((latest - baseline).toFixed(digits));
  if (delta === 0) return "±0";
  return delta > 0 ? `+${delta.toFixed(digits)}` : `−${Math.abs(delta).toFixed(digits)}`;
}

function minutesSince(timestamp) {
  const date = parseUtc(timestamp);
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}

// Stress is Presage EDA -- small fractions like 0.039, so it needs decimals.
const VITALS = [
  { key: "heart_rate", label: "HR", title: "Heart rate (bpm)", digits: 0 },
  { key: "breathing_rate", label: "RR", title: "Breathing rate (breaths/min)", digits: 0 },
  { key: "stress_score", label: "EDA", title: "Stress (EDA measurement)", digits: 3 },
  { key: "face_asymmetry_score", label: "Face", title: "Face asymmetry score", digits: 4 },
];

// "+38" -> up, "−5" -> down, "±0" -> flat (the arrow is display only).
function deltaDirection(delta) {
  if (delta.startsWith("+")) return "up";
  if (delta.startsWith("−")) return "down";
  return "flat";
}
const DELTA_ARROW = { up: " ▲", down: " ▼", flat: "" };

function formatAgo(timestamp) {
  const minutes = minutesSince(timestamp);
  if (minutes == null) return null;
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

function formatRecheck(patient) {
  if (patient.missed_recheck) return null; // shown as the amber flag instead
  if (patient.recheck_due) return { text: "Recheck due", due: true };
  const next = parseUtc(patient.next_recheck_at);
  if (!next) return null; // no reading yet, or already called to triage
  const seconds = Math.max(0, Math.round((next.getTime() - Date.now()) / 1000));
  const when = seconds < 120 ? `${Math.max(5, Math.ceil(seconds / 5) * 5)} s` : `${Math.ceil(seconds / 60)} min`;
  return { text: `Next recheck in ${when}`, due: false };
}

export default function PatientCard({ patient, risk, nextUp, onAcknowledge, onCall }) {
  const baseline = patient.baseline_reading;
  // Until the first rescan, the latest reading *is* the baseline.
  const latest = patient.latest_reading && !Number(patient.latest_reading.is_baseline)
    ? patient.latest_reading
    : null;
  const alert = patient.latest_alert;
  const isOpen = Boolean(alert) && !Number(alert.acknowledged);
  const minutes = minutesSince(baseline?.created_at || patient.created_at);
  const calledAgo = formatAgo(patient.last_called_at);
  const recheck = formatRecheck(patient);
  const missed = Boolean(patient.missed_recheck);

  const pulsing = risk === "high" && isOpen;

  return (
    <article className={`patient-card risk-${risk}${pulsing ? " pulse" : ""}${missed ? " missed" : ""}`}>
      <div className="card-header">
        <div className="identity">
          <h2 className="patient-title">
            <span className="patient-number">#{patient.id}</span>
            <span className="patient-name">{patient.name}</span>
          </h2>
          <p className="complaint">{patient.chief_complaint || "No complaint recorded"}</p>
        </div>
        <div className="card-header-right">
          <div className="status-labels">
            {nextUp && <span className="next-up">Next up</span>}
            {missed && <span className="status-label status-missed">Missed recheck</span>}
            <span className={`status-label risk-label risk-label-${risk}`}>
              {pulsing && <span className="pulse-dot" aria-hidden="true" />}
              {risk.toUpperCase()}
            </span>
          </div>
          <span className="wait-time">
            {minutes == null ? "—" : `${minutes} min`} since triage
          </span>
        </div>
      </div>

      {missed && (
        <p className="missed-flag" role="status">
          Missed recheck — check on patient
        </p>
      )}

      {alert && (
        <div className="alert-block">
          <p className="reason">{alert.reason_text || "Alert received."}</p>
          {alert.recommended_action && <p className="action">{alert.recommended_action}</p>}
        </div>
      )}

      <table className="vitals">
        <thead>
          <tr>
            <th scope="col"><span className="visually-hidden">Vital</span></th>
            <th scope="col">Baseline</th>
            <th scope="col">Latest</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {VITALS.map(({ key, label, title, digits }) => {
            const delta = formatDelta(baseline?.[key], latest?.[key], digits);
            const direction = delta && deltaDirection(delta);
            return (
              <tr key={key}>
                <th scope="row" title={title}>{label}</th>
                <td>{formatValue(baseline?.[key], digits)}</td>
                <td className="latest">{formatValue(latest?.[key], digits)}</td>
                <td>
                  {delta ? (
                    <span className={`delta delta-${direction}`}>
                      {delta}
                      {DELTA_ARROW[direction]}
                    </span>
                  ) : (
                    <span className="delta delta-none">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="units">HR bpm · RR breaths/min · EDA measurement · Face asymmetry score{latest ? "" : " · awaiting rescan"}</p>

      <div className="card-footer">
        <div className="call-status">
          {calledAgo && <span className="called-ago">Called {calledAgo}</span>}
          {recheck && <span className={`recheck${recheck.due ? " recheck-due" : ""}`}>{recheck.text}</span>}
          {alert && !isOpen && <span className="acked">Acknowledged</span>}
        </div>
        <div className="card-actions">
          {alert && isOpen && (
            <button className="button button-secondary ack-button" onClick={() => onAcknowledge(patient.id)}>
              Acknowledge
            </button>
          )}
          <button
            className={`button call-button${calledAgo ? " button-secondary called" : " button-primary"}`}
            onClick={() => onCall(patient.id)}
          >
            {calledAgo ? "Call again" : "Call patient"}
          </button>
        </div>
      </div>
    </article>
  );
}
