import { useEffect, useRef, useState } from "react";
import { capture } from "../lib/presage.js";
import { submitReading } from "../api/client.js";

export default function Rescan({ patient, onDone }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [lastAlert, setLastAlert] = useState(null);

  async function handleRescan() {
    setStatus("starting-camera");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current.srcObject = stream;
      setStatus("capturing");

      const vitals = await capture(videoRef.current);
      setStatus("saving");

      const { alert } = await submitReading({
        patient_id: patient.id,
        heart_rate: vitals.heart_rate,
        breathing_rate: vitals.breathing_rate,
        stress_score: vitals.stress_score,
        is_baseline: false,
      });

      setLastAlert(alert);
      setStatus("done");
      onDone?.(vitals, alert);
    } catch (err) {
      console.error(err);
      setStatus("error");
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
    }
  }

  useEffect(() => {
    // Auto-start for demo convenience; remove if you want a manual button only.
  }, []);

  return (
    <div className="screen">
      <h1>Rescan — {patient.name}</h1>
      <p>Please look at the camera again for your follow-up check.</p>
      <video ref={videoRef} autoPlay muted playsInline className="camera-preview" />
      <button onClick={handleRescan} disabled={status === "capturing" || status === "saving"}>
        {status === "idle" || status === "done" ? "Start Rescan" : "Working..."}
      </button>
      {lastAlert && (
        <p className={`risk-badge risk-${lastAlert.risk_level}`}>
          {lastAlert.reason_text}
        </p>
      )}
    </div>
  );
}
