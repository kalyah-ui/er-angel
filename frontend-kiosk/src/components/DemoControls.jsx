import { useState } from "react";
import { NotFoundError } from "../api/client.js";

const HINT = "D: elevated rescan · M: manual vitals · R: recheck reminder · Esc: close";

/** Demo key R: type a patient number -> they get a recheck announcement now. */
function RecheckPrompt({ onTrigger, onClose }) {
  const [number, setNumber] = useState("");
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const trimmed = number.trim();
    if (!/^\d+$/.test(trimmed) || sending) return;
    setSending(true);
    setError(null);
    try {
      await onTrigger(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof NotFoundError ? `No patient #${trimmed}` : "Backend unreachable");
      setSending(false);
    }
  }

  return (
    <form className="manual-panel" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
      <p className="manual-title">Recheck reminder — now</p>
      <div className="manual-fields">
        <label>
          Patient #
          <input
            value={number}
            onChange={(e) => {
              setNumber(e.target.value);
              setError(null);
            }}
            inputMode="numeric"
            autoFocus
          />
        </label>
      </div>
      {error && <p className="manual-error">{error}</p>}
      <div className="manual-actions">
        <button type="submit" disabled={!/^\d+$/.test(number.trim()) || sending}>
          {sending ? "Sending…" : "Announce"}
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="manual-hint">{HINT}</p>
    </form>
  );
}

/**
 * Presenter-only controls. Nothing here is visible to a judge except:
 *  - tiny dots (bottom-right): a demo override is armed (D red, M blue),
 *    or the R prompt is open (green)
 *  - a small "demo mode" tag (bottom-left) when the Presage agent is unavailable
 * The M key opens manual vitals entry, R the recheck-reminder prompt.
 */
export default function DemoControls({
  armed,
  demoMode,
  manualOpen,
  onArm,
  onCloseManual,
  recheckOpen,
  onTriggerRecheck,
  onCloseRecheck,
}) {
  const [hr, setHr] = useState("");
  const [rr, setRr] = useState("");

  const hrValue = Number(hr);
  const rrValue = Number(rr);
  const valid = hr !== "" && rr !== "" && hrValue > 20 && hrValue < 250 && rrValue > 2 && rrValue < 70;

  function armManual(e) {
    e.preventDefault();
    if (!valid) return;
    onArm({ type: "manual", heart_rate: hrValue, breathing_rate: rrValue });
    onCloseManual();
  }

  const dotTitle =
    armed?.type === "elevated"
      ? "Armed: next rescan = baseline + HR 35 / RR 5 (press D to disarm)"
      : armed?.type === "manual"
        ? `Armed: next capture = HR ${armed.heart_rate} / RR ${armed.breathing_rate}`
        : null;

  return (
    <>
      {armed && <span className={`demo-dot demo-dot-${armed.type}`} title={dotTitle} aria-hidden="true" />}
      {recheckOpen && <span className="demo-dot demo-dot-recheck" title="R: recheck reminder prompt open" aria-hidden="true" />}
      {demoMode && <span className="demo-mode-tag">demo mode</span>}

      {manualOpen && (
        <form className="manual-panel" onSubmit={armManual} onClick={(e) => e.stopPropagation()}>
          <p className="manual-title">Manual vitals — next capture</p>
          <div className="manual-fields">
            <label>
              HR
              <input value={hr} onChange={(e) => setHr(e.target.value)} inputMode="decimal" autoFocus />
            </label>
            <label>
              RR
              <input value={rr} onChange={(e) => setRr(e.target.value)} inputMode="decimal" />
            </label>
          </div>
          <div className="manual-actions">
            <button type="submit" disabled={!valid}>
              Arm
            </button>
            {armed?.type === "manual" && (
              <button type="button" onClick={() => onArm(null)}>
                Clear
              </button>
            )}
            <button type="button" onClick={onCloseManual}>
              Close
            </button>
          </div>
          <p className="manual-hint">{HINT}</p>
        </form>
      )}

      {recheckOpen && <RecheckPrompt onTrigger={onTriggerRecheck} onClose={onCloseRecheck} />}
    </>
  );
}
