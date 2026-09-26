import { useEffect, useState } from "react";
import PatientList from "./components/PatientList.jsx";
import AlertFeed from "./components/AlertFeed.jsx";
import { fetchPatients, fetchAlerts, acknowledgeAlert, poll } from "./api/client.js";

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

  return (
    <div className="dashboard">
      <header>
        <h1>WaitWatch — Nurse Dashboard</h1>
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
