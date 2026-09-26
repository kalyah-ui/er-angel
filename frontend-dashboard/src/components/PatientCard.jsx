export default function PatientCard({ patient }) {
  const risk = patient.latest_alert?.risk_level || "low";
  const reading = patient.latest_reading;

  return (
    <div className={`patient-card risk-${risk}`}>
      <div className="patient-card-header">
        <strong>{patient.name}</strong>
        <span className={`risk-pill risk-pill-${risk}`}>{risk.toUpperCase()}</span>
      </div>
      <p className="complaint">{patient.chief_complaint || "No complaint recorded"}</p>
      {reading && (
        <p className="vitals">
          HR {reading.heart_rate ?? "--"} bpm · RR {reading.breathing_rate ?? "--"} /min
        </p>
      )}
      {patient.latest_alert && (
        <p className="alert-line">{patient.latest_alert.reason_text}</p>
      )}
    </div>
  );
}
