import { useState } from "react";

export default function CheckInForm({ onSubmit, onCancel }) {
  const [name, setName] = useState("");
  const [complaint, setComplaint] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    // App takes over from here (capture screen, or front desk on error).
    onSubmit({ name: name.trim(), chief_complaint: complaint.trim() });
  }

  return (
    <main className="screen">
      <p className="brand">ER Angel</p>
      <h1>Let's get you checked in</h1>
      <form className="form" onSubmit={handleSubmit}>
        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            autoFocus
            required
          />
        </label>
        <label>
          What brought you in today?
          <textarea
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            rows={3}
            placeholder="For example: chest tightness, dizziness, a fall"
          />
        </label>
        <div className="actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!name.trim() || submitting}>
            {submitting ? "Checking in…" : "Continue"}
          </button>
        </div>
      </form>
    </main>
  );
}
