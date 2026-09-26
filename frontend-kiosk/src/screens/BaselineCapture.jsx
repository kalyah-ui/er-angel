import { useEffect, useRef, useState } from "react";
import { capture } from "../lib/presage.js";
import { submitReading } from "../api/client.js";

export default function BaselineCapture({ patient, onDone }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState("starting-camera");

  useEffect(() => {
    let stream;

    async function run() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoRef.current.srcObject = stream;
        setStatus("capturing");

        const vitals = await capture(videoRef.current);
        setStatus("saving");

        await submitReading({
          patient_id: patient.id,
          heart_rate: vitals.heart_rate,
          breathing_rate: vitals.breathing_rate,
          stress_score: vitals.stress_score,
          face_asymmetry_score: vitals.face_asymmetry_score,
          is_baseline: true,
        });

        setStatus("done");
        onDone(vitals);
      } catch (err) {
        console.error(err);
        setStatus("error");
      }
    }

    run();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [patient, onDone]);

  return (
    <div className="screen">
      <h1>Taking your baseline reading</h1>
      <p>Please look at the camera and stay still for a moment.</p>
      <video ref={videoRef} autoPlay muted playsInline className="camera-preview" />
      <p className="status">
        {status === "starting-camera" && "Starting camera..."}
        {status === "capturing" && "Measuring vitals..."}
        {status === "saving" && "Saving your baseline..."}
        {status === "done" && "Baseline captured. Thank you!"}
        {status === "error" && "Something went wrong. Please tell the front desk."}
      </p>
    </div>
  );
}
