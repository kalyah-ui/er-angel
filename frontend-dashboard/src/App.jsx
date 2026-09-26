import { useEffect, useState } from "react";
import PatientList from "./components/PatientList.jsx";
import AlertFeed from "./components/AlertFeed.jsx";
import { fetchPatients, fetchAlerts, acknowledgeAlert, resetDemo, poll } from "./api/client.js";
const POLL_INTERVAL_MS = 5000;

export default function App() {
  const [patients, setPatients] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const stopPatients = poll(fetchPatients, POLL_INTERVAL_MS, setPatients, () =>
      setError("Could not reach backend")
    );
    const stopAlerts = poll(fetchAlerts, POLL_INTERVAL_MS, setAlerts, () =>
      setError("Could not reach backend")
    );
    return () => {
      stopPatients();
      stopAlerts();
    };
  }, []);

  async function handleAck(id) {
    await acknowledgeAlert(id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: 1 } : a)));
  }

  async function handleReset() {
    if (!confirm("Reset all demo data? This clears every patient, reading, and alert.")) return;
    await resetDemo(true);
    setPatients(await fetchPatients());
    setAlerts(await fetchAlerts());
  }

  return (
    <div className="dashboard">
      <header>
        <div className="header-row">
          <h1>WaitWatch — Nurse Dashboard</h1>
          <button className="reset-button" onClick={handleReset}>Reset Demo</button>
        </div>
        {error && <p className="error">{error}</p>}
      </header>
      <section>
        <h2>Active Alerts</h2>
        <AlertFeed alerts={alerts} onAcknowledge={handleAck} />
      </section>
      <section>
        <h2>All Patients</h2>
        <PatientList patients={patients} />
      </section>
    </div>
  );
}
