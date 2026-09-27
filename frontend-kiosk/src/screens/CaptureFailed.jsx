import { useEffect, useRef } from "react";

// A patient who walks away shouldn't leave the kiosk stuck on this screen.
const AUTO_RETURN_MS = 60000;

/**
 * The camera agent was reachable but couldn't produce a reading (poor
 * framing for too long, an SDK error, or busy). Nothing was stored; "Try
 * again" re-runs the same capture. Demo overrides (D/M) armed now apply to
 * the retry.
 */
export default function CaptureFailed({ onRetry, onCancel }) {
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const timer = setTimeout(() => onCancelRef.current(), AUTO_RETURN_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="screen message message-warning">
      <div className="message-icon" aria-hidden="true">
        !
      </div>
      <h1>We couldn't get a reading.</h1>
      <p className="lead">Let's try again. Please sit still, face the camera, and keep your face and chest in view.</p>
      <div className="actions retry-actions">
        <button className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" onClick={onRetry} autoFocus>
          Try again
        </button>
      </div>
    </main>
  );
}
