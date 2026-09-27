import { useCallback, useEffect, useRef, useState } from "react";
import Welcome from "./screens/Welcome.jsx";
import CheckInForm from "./screens/CheckInForm.jsx";
import RescanLookup from "./screens/RescanLookup.jsx";
import Capture from "./screens/Capture.jsx";
import CaptureFailed from "./screens/CaptureFailed.jsx";
import Message from "./screens/Message.jsx";
import DemoControls from "./components/DemoControls.jsx";
import MuteToggle from "./components/MuteToggle.jsx";
import AnnouncementBanner from "./components/AnnouncementBanner.jsx";
import { checkIn, getBaseline, getPatient, submitReading, triggerRecheck, NotFoundError } from "./api/client.js";
import { acquireVitals, CaptureCancelledError, CaptureFailedError } from "./lib/capture.js";
import { isAgentAvailable } from "./lib/presage.js";
import { useAnnouncer } from "./lib/useAnnouncer.js";
import { isMuted, playPrompt, setMuted, unlockAudio } from "./lib/voice.js";

const AUTO_RETURN_MS = 8000;

function isTypingTarget(el) {
  return el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export default function App() {
  // welcome | checkin | rescan | capture | checkedIn | thanks | frontDesk
  const [screen, setScreen] = useState({ name: "welcome" });
  // Demo override for the next capture: null | { type: "elevated" } | { type: "manual", heart_rate, breathing_rate }
  const [armed, setArmedState] = useState(null);
  const armedRef = useRef(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [recheckOpen, setRecheckOpen] = useState(false);
  // true once the Presage agent is found unreachable/failing and we fall back to mock vitals
  const [demoMode, setDemoMode] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  // PA announcements (nurse triage calls, recheck reminders). Shown during a
  // capture too, but only spoken once it's over.
  const { banner, pollNow } = useAnnouncer(screen.name === "capture");
  // Bumped whenever a flow starts or is cancelled, so stale async steps bail out.
  const flowId = useRef(0);
  // AbortController for whichever capture is currently in flight, so the
  // Cancel button can actually interrupt acquireVitals() instead of only
  // changing which screen is shown while the capture keeps running underneath.
  const captureAbortRef = useRef(null);

  const setArmed = useCallback((next) => {
    armedRef.current = typeof next === "function" ? next(armedRef.current) : next;
    setArmedState(armedRef.current);
  }, []);

  useEffect(() => {
    isAgentAvailable().then((ok) => {
      if (!ok) console.warn("[kiosk] DEMO MODE: Presage agent unreachable -- captures will use mock vitals");
      setDemoMode(!ok);
    });
  }, []);

  // Browsers block audio until a user gesture. Capture phase runs before the
  // Welcome screen's own click handler, so audio is unlocked by the time the
  // tap moves to the check-in screen and its welcome line plays. `click` (not
  // pointerdown) because a touch pointerdown doesn't count as a gesture.
  useEffect(() => {
    window.addEventListener("click", unlockAudio, true);
    window.addEventListener("keydown", unlockAudio, true);
    return () => {
      window.removeEventListener("click", unlockAudio, true);
      window.removeEventListener("keydown", unlockAudio, true);
    };
  }, []);

  // One voice line per screen (lib/voice.js); stops the previous line first.
  useEffect(() => {
    playPrompt(screen.name, screen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.name]);

  // Hidden demo controls: D arms elevated vitals for the next rescan, M opens
  // manual entry, R opens the recheck-reminder prompt. Esc closes panels.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") {
        setManualOpen(false);
        setRecheckOpen(false);
        return;
      }
      // Don't hijack letters typed into the check-in form.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "d") {
        setArmed((prev) => (prev?.type === "elevated" ? null : { type: "elevated" }));
      } else if (key === "m") {
        setRecheckOpen(false);
        setManualOpen((open) => !open);
      } else if (key === "r") {
        setManualOpen(false);
        setRecheckOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setArmed]);

  // Demo key R: remind a patient right now, exactly like a timed reminder.
  async function handleTriggerRecheck(patientNumber) {
    await triggerRecheck(patientNumber); // NotFoundError / BackendUnavailableError -> shown in the prompt
    pollNow();
  }

  function goHome() {
    flowId.current++;
    setScreen({ name: "welcome" });
  }

  // Cancel button on the capture screen. Aborts whichever capture is
  // actually in flight (manual/elevated/mock sleep, or the Presage agent
  // request -- acquireVitals sorts out which) before navigating home, so
  // the backend camera/SDK is told to stop instead of continuing to run
  // while the kiosk has already moved on to another screen.
  function handleCancelCapture() {
    captureAbortRef.current?.abort();
    goHome();
  }

  function showFrontDesk(err) {
    console.error("[kiosk] sending patient to front desk:", err);
    setScreen({ name: "frontDesk" });
  }

  // Runs capture -> POST /reading -> confirmation. Driven from event
  // handlers (not effects) so StrictMode can't run a capture twice.
  async function runCapture(id, { mode, patient, baseline, createPatient = false }) {
    const override = armedRef.current;
    // Manual values apply to any capture; the elevated demo only makes sense on a rescan.
    const useOverride = override && (override.type === "manual" || mode === "rescan") ? override : null;
    if (useOverride) setArmed(null);

    const controller = new AbortController();
    captureAbortRef.current = controller;

    setScreen({ name: "capture", mode, patient, durationMs: null, startedAt: null, saving: false });

    const { vitals, source } = await acquireVitals({
      mode,
      baseline,
      override: useOverride,
      signal: controller.signal,
      onStart: (durationMs) => {
        if (flowId.current === id) setScreen((s) => ({ ...s, durationMs, startedAt: Date.now() }));
      },
    });
    if (flowId.current !== id) return;

    if (source === "presage" || source === "mock") setDemoMode(source === "mock");
    console.info(`[kiosk] ${mode} vitals captured (source: ${source})`, vitals);

    setScreen((s) => ({ ...s, saving: true }));
    const savedPatient = createPatient ? await checkIn(patient) : patient;
    if (flowId.current !== id) return;

    console.info(`[kiosk] saving ${mode} reading for patient ${savedPatient.id}`);
    await submitReading({ patient_id: savedPatient.id, ...vitals, is_baseline: mode === "baseline" });
    if (flowId.current !== id) return;

    setScreen({ name: mode === "baseline" ? "checkedIn" : "thanks", patient: savedPatient });
  }

  // Runs a capture flow and routes how it ended. Cancelled: nothing to do
  // (handleCancelCapture already went home). Agent reachable but no reading:
  // "We couldn't get a reading" with a retry of the same capture -- nothing
  // is stored, and D/M overrides armed meanwhile apply to the retry.
  // Anything else (e.g. backend down): front desk.
  async function startCapture(args, id = ++flowId.current) {
    try {
      await runCapture(id, args);
    } catch (err) {
      if (err instanceof CaptureCancelledError || flowId.current !== id) return;
      if (err instanceof CaptureFailedError) {
        setScreen({ name: "captureFailed", retry: args });
        return;
      }
      showFrontDesk(err);
    }
  }

  function handleCheckIn(form) {
    return startCapture({ mode: "baseline", patient: form, baseline: null, createPatient: true });
  }

  // Unknown patient numbers are rethrown so the lookup form can show them inline.
  async function handleRescan(patientNumber) {
    const id = ++flowId.current;
    let patient;
    try {
      patient = await getPatient(patientNumber);
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      if (flowId.current === id) showFrontDesk(err);
      return;
    }

    let baseline;
    try {
      baseline = await getBaseline(patient.id);
    } catch (err) {
      if (flowId.current === id) showFrontDesk(err);
      return;
    }
    if (flowId.current !== id) return;
    await startCapture({ mode: "rescan", patient, baseline }, id);
  }

  function renderScreen() {
    switch (screen.name) {
      case "checkin":
        return <CheckInForm onSubmit={handleCheckIn} onCancel={goHome} />;
      case "rescan":
        return <RescanLookup onSubmit={handleRescan} onCancel={goHome} />;
      case "capture":
        return <Capture {...screen} onCancel={handleCancelCapture} />;
      case "captureFailed":
        return <CaptureFailed onRetry={() => startCapture(screen.retry)} onCancel={goHome} />;
      case "checkedIn":
        return (
          <Message
            title="You're checked in"
            highlight={`Patient #${screen.patient.id}`}
            body="Please have a seat. A nurse will call you soon. Remember your patient number for your follow-up check."
            autoReturnMs={AUTO_RETURN_MS}
            onDone={goHome}
          />
        );
      case "thanks":
        return (
          <Message
            title="Thank you"
            body="Please have a seat. Your care team has your latest reading."
            autoReturnMs={AUTO_RETURN_MS}
            onDone={goHome}
          />
        );
      case "frontDesk":
        return (
          <Message
            tone="warning"
            title="Please see the front desk"
            body="We couldn't complete that just now. A staff member will help you."
            autoReturnMs={AUTO_RETURN_MS * 2}
            onDone={goHome}
          />
        );
      default:
        return (
          <Welcome
            onCheckIn={() => setScreen({ name: "checkin" })}
            onRescan={() => setScreen({ name: "rescan" })}
          />
        );
    }
  }

  return (
    <>
      {renderScreen()}
      <AnnouncementBanner banner={banner} />
      <MuteToggle
        muted={muted}
        onToggle={() => {
          setMuted(!muted);
          setMutedState(!muted);
        }}
      />
      <DemoControls
        armed={armed}
        demoMode={demoMode}
        manualOpen={manualOpen}
        onArm={setArmed}
        onCloseManual={() => setManualOpen(false)}
        recheckOpen={recheckOpen}
        onTriggerRecheck={handleTriggerRecheck}
        onCloseRecheck={() => setRecheckOpen(false)}
      />
    </>
  );
}