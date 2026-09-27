import { useEffect, useRef, useState } from "react";
import PatientList, { riskOf } from "./components/PatientList.jsx";
import Clock from "./components/Clock.jsx";
import { fetchPatients, fetchAlerts, acknowledgeAlert, callPatient, resetDemo, poll } from "./api/client.js";

const POLL_INTERVAL_MS = 5000;
const RESET_CONFIRM_MS = 4000;

async function fetchAll() {
  const [patients, alerts] = await Promise.all([fetchPatients(), fetchAlerts()]);
  return { patients, alerts };
}

export default function App() {
  const [patients, setPatients] = useState([]);
  const [alerts, setAlerts] = useState([]);
  // null = first load in progress, true = last poll succeeded, false = backend unreachable
  const [connected, setConnected] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [resetState, setResetState] = useState("idle"); // idle | confirm | working | failed
  const resetTimer = useRef(null);

  function applyData({ patients, alerts }) {
    setPatients(patients);
    setAlerts(alerts);
    setConnected(true);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    const stop = poll(fetchAll, POLL_INTERVAL_MS, applyData, () => setConnected(false));
    return () => {
      stop();
      clearTimeout(resetTimer.current);
    };
  }, []);

  // Acknowledges every open alert for the patient, not just the latest, so
  // older rescans don't linger as unacknowledged in the backend.
  async function handleAcknowledge(patientId) {
    const openIds = alerts
      .filter((a) => a.patient_id === patientId && !Number(a.acknowledged))
      .map((a) => a.id);
    const latestId = patients.find((p) => p.id === patientId)?.latest_alert?.id;
    if (latestId != null && !openIds.includes(latestId)) openIds.push(latestId);

    const markAcked = (a) => (openIds.includes(a.id) ? { ...a, acknowledged: 1 } : a);
    setAlerts((prev) => prev.map(markAcked));
    setPatients((prev) =>
      prev.map((p) => (p.latest_alert ? { ...p, latest_alert: markAcked(p.latest_alert) } : p))
    );

    try {
      await Promise.all(openIds.map(acknowledgeAlert));
    } catch {
      setConnected(false);
    }
  }

  // Always a nurse click -- patients are never called to triage automatically.
  async function handleCall(patientId) {
    const calledAt = new Date().toISOString();
    setPatients((prev) => prev.map((p) => (p.id === patientId ? { ...p, last_called_at: calledAt } : p)));
    try {
      await callPatient(patientId);
    } catch {
      setConnected(false); // next successful poll restores the real state
    }
  }

  async function handleReset() {
    clearTimeout(resetTimer.current);
    if (resetState !== "confirm") {
      setResetState("confirm");
      resetTimer.current = setTimeout(() => setResetState("idle"), RESET_CONFIRM_MS);
      return;
    }

    setResetState("working");
    try {
      await resetDemo(true);
      applyData(await fetchAll());
      setResetState("idle");
    } catch {
      setConnected(false);
      setResetState("failed");
      resetTimer.current = setTimeout(() => setResetState("idle"), RESET_CONFIRM_MS);
    }
  }

  const openAlertCount = alerts.filter((a) => !Number(a.acknowledged)).length;
  const highCount = patients.filter((p) => riskOf(p) === "high").length;
  const missedCount = patients.filter((p) => p.missed_recheck).length;

  const resetLabel = {
    idle: "Reset demo",
    confirm: "Click again to reset",
    working: "Resetting…",
    failed: "Reset failed",
  }[resetState];

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="wordmark">ER Angel</span>
            <span className="brand-sub">Waiting room</span>
          </div>
          <div className="topbar-meta">
            <p className="header-stats">
              <span>{patients.length} waiting</span>
              <span className="stat-sep" aria-hidden="true"> · </span>
              <span className={highCount ? "stat-high" : undefined}>{highCount} high</span>
              <span className="stat-sep" aria-hidden="true"> · </span>
              <span className={missedCount ? "stat-missed" : undefined}>
                {missedCount} missed {missedCount === 1 ? "recheck" : "rechecks"}
              </span>
              <span className="stat-sep" aria-hidden="true"> · </span>
              <span className={`alert-count${openAlertCount ? " has-alerts" : ""}`}>
                {openAlertCount} open {openAlertCount === 1 ? "alert" : "alerts"}
              </span>
            </p>
            <Clock />
            <button
              className={`reset-button reset-${resetState}`}
              onClick={handleReset}
              disabled={resetState === "working"}
            >
              {resetLabel}
            </button>
          </div>
        </div>
        {connected === false && (
          <div className="banner" role="status">
            <span className="banner-dot" aria-hidden="true" />
            Reconnecting to backend… showing last known data
            {lastUpdated && ` from ${lastUpdated.toLocaleTimeString()}`}
          </div>
        )}
      </header>

      <main className="content">
        {connected === null ? (
          <p className="empty">Connecting…</p>
        ) : (
          <PatientList patients={patients} onAcknowledge={handleAcknowledge} onCall={handleCall} />
        )}
      </main>
    </div>
  );
}
