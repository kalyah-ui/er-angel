import { useState } from "react";
import { checkIn } from "../api/client.js";

export default function CheckIn({ onCheckedIn }) {
  const [name, setName] = useState("");
  const [complaint, setComplaint] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const patient = await checkIn({ name, chief_complaint: complaint });
      onCheckedIn(patient);
    } catch (err) {
      setError("Could not check in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen">
      <h1>Welcome to WaitWatch</h1>
      <p>Please check in below. We'll take a quick, contactless vitals reading next.</p>
      <form onSubmit={handleSubmit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          What brought you in today?
          <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={3} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Checking in..." : "Check In"}
        </button>
      </form>
    </div>
  );
}
