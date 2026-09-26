import { useEffect, useState } from "react";
import { fetchStatus } from "../lib/presage.js";

const RADIUS = 88;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const POLL_MS = 500;

/**
 * Combines the live framing hint AND the capture progress into one poll
 * loop. When the agent reports a real capture in progress (collecting:
 * true, targetMs set), we trust its goodElapsedMs -- which only advances
 * while framing is good -- so the countdown naturally pauses during bad
 * framing instead of ticking down on wall-clock time regardless of data
 * quality. For non-agent paths (manual override, mock/demo vitals), the
 * agent isn't running a capture at all, so we fall back to a simple local
 * wall-clock countdown from startedAt/durationMs, exactly as before.
 */
function useCaptureProgress(active, startedAt, durationMs) {
  const [hint, setHint] = useState(null);
  const [serverProgress, setServerProgress] = useState(null); // { goodElapsedMs, targetMs } | null
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!active) {
      setHint(null);
      setServerProgress(null);
      return;
    }

    let cancelled = false;

    async function poll() {
      const status = await fetchStatus();
      if (cancelled || !status) return;

      setHint(status.hint || null);

      if (status.collecting && status.targetMs > 0) {
        setServerProgress({ goodElapsedMs: status.goodElapsedMs, targetMs: status.targetMs });
      } else {
        setServerProgress(null); // not a real agent capture -- use local fallback
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  // Local wall-clock ticker, only needed for the fallback path.
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [startedAt]);

  let secondsLeft = null;
  if (serverProgress) {
    const msLeft = Math.max(0, serverProgress.targetMs - serverProgress.goodElapsedMs);
    secondsLeft = Math.ceil(msLeft / 1000);
  } else if (startedAt && durationMs) {
    secondsLeft = Math.max(0, Math.ceil((startedAt + durationMs - now) / 1000));
  }

  return { secondsLeft, hint };
}

export default function Capture({ mode, durationMs, startedAt, saving, onCancel }) {
  const active = !!startedAt && !saving;
  const { secondsLeft, hint } = useCaptureProgress(active, startedAt, durationMs);
  const counting = secondsLeft != null && secondsLeft > 0 && !saving;

  let status;
  if (saving) status = "Saving your reading…";
  else if (secondsLeft == null) status = "Getting ready…";
  else if (hint) status = "Adjust your position…";
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
              style={{ "--circumference": CIRCUMFERENCE, animationDuration: `${durationMs}ms`, animationPlayState: hint ? "paused" : "running" }}
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

      {hint && (
        <p className="framing-hint" role="alert">
          {hint}
        </p>
      )}

      {!saving && (
        <button className="text-button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </main>
  );
}