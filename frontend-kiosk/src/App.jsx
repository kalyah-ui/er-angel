import { useState } from "react";
import CheckIn from "./screens/CheckIn.jsx";
import BaselineCapture from "./screens/BaselineCapture.jsx";
import Rescan from "./screens/Rescan.jsx";

export default function App() {
  const [patient, setPatient] = useState(null);
  const [baselineDone, setBaselineDone] = useState(false);

  if (!patient) {
    return <CheckIn onCheckedIn={setPatient} />;
  }

  if (!baselineDone) {
    return <BaselineCapture patient={patient} onDone={() => setBaselineDone(true)} />;
  }

  return <Rescan patient={patient} />;
}
