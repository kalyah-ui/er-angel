import PatientCard from "./PatientCard.jsx";

export default function PatientList({ patients }) {
  if (!patients.length) {
    return <p className="empty">No patients checked in yet.</p>;
  }

  return (
    <div className="patient-grid">
      {patients.map((p) => (
        <PatientCard key={p.id} patient={p} />
      ))}
    </div>
  );
}
