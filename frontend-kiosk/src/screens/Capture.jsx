import { useEffect, useState } from "react";

const RADIUS = 88;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function useSecondsLeft(startedAt, durationMs) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (!startedAt || !durationMs) return null;
  return Math.max(0, Math.ceil((startedAt + durationMs - now) / 1000));
}

export default function Capture({ mode, durationMs, startedAt, saving, onCancel }) {
  const secondsLeft = useSecondsLeft(startedAt, durationMs);
  const counting = secondsLeft != null && secondsLeft > 0 && !saving;

  let status;
  if (saving) status = "Saving your reading…";
  else if (secondsLeft == null) status = "Getting ready…";
  else if (secondsLeft > 0) status = "Measuring… please stay still";
  else status = "Almost done…";

  return (
    <main className="screen capture">
      <p className="brand">ER Angel</p>
      <h1>Please look at the camera and stay still</h1>
      <p className="lead">
        {mode === "baseline"
          ? "We're taking a quick, contactless reading of your heart and breathing rate."
          : "A quick follow-up reading, just like before."}
      </p>

      <div className="ring" aria-live="polite">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle className="ring-track" cx="100" cy="100" r={RADIUS} />
          {startedAt && (
            <circle
              key={startedAt}
              className="ring-progress"
              cx="100"
              cy="100"
              r={RADIUS}
              strokeDasharray={CIRCUMFERENCE}
              style={{ "--circumference": CIRCUMFERENCE, animationDuration: `${durationMs}ms` }}
            />
          )}
        </svg>
        <div className="ring-label">
          {counting ? (
            <>
              <span className="ring-seconds">{secondsLeft}</span>
              <span className="ring-unit">seconds</span>
            </>
          ) : (
            <span className="ring-dots" aria-hidden="true">•••</span>
          )}
        </div>
      </div>

      <p className="status">{status}</p>

      {!saving && (
        <button className="text-button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </main>
  );
}
