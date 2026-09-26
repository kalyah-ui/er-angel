import { useEffect, useRef } from "react";

/** Full-screen message that returns to the welcome screen on tap or after `autoReturnMs`. */
export default function Message({ title, highlight, body, tone = "calm", autoReturnMs, onDone }) {
  // Ref so parent re-renders (new onDone identity) don't restart the timer.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const timer = setTimeout(() => onDoneRef.current(), autoReturnMs);
    return () => clearTimeout(timer);
  }, [autoReturnMs]);

  return (
    <main className={`screen message message-${tone}`} onClick={onDone}>
      <div className="message-icon" aria-hidden="true">
        {tone === "warning" ? "!" : "✓"}
      </div>
      <h1>{title}</h1>
      {highlight && <p className="highlight">{highlight}</p>}
      <p className="lead">{body}</p>
      <button className="primary" onClick={onDone}>
        Done
      </button>
    </main>
  );
}
