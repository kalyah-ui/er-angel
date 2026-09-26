import { useState } from "react";
import { NotFoundError } from "../api/client.js";

export default function RescanLookup({ onSubmit, onCancel }) {
  const [number, setNumber] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = number.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError("Please enter the number shown when you checked in.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed); // App moves on to the capture screen
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      setError(`We couldn't find patient #${trimmed}. Please check the number, or see the front desk.`);
      setSubmitting(false);
    }
  }

  return (
    <main className="screen">
      <p className="brand">ER Angel</p>
      <h1>Follow-up check</h1>
      <form className="form" onSubmit={handleSubmit}>
        <label>
          Your patient number
          <input
            className="number-input"
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
              setError(null);
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            autoFocus
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!number.trim() || submitting}>
            {submitting ? "Looking up…" : "Continue"}
          </button>
        </div>
      </form>
    </main>
  );
}
