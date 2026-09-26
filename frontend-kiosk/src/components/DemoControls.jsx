import { useState } from "react";

/**
 * Presenter-only controls. Nothing here is visible to a judge except:
 *  - a tiny dot (bottom-right) while a demo override is armed
 *  - a small "demo mode" tag (bottom-left) when the Presage agent is unavailable
 * The manual-entry panel opens with the M key.
 */
export default function DemoControls({ armed, demoMode, manualOpen, onArm, onCloseManual }) {
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
          <p className="manual-hint">D: elevated rescan · M: this panel · Esc: close</p>
        </form>
      )}
    </>
  );
}
