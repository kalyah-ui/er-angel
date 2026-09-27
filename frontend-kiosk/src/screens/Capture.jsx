import { useEffect, useRef, useState } from "react";
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

/**
 * Local, best-effort camera preview for the patient to see themselves and
 * line up with the alignment guide. Completely independent of the Presage
 * agent's own capture -- the agent has its own separate handle on the
 * physical camera (see presage-agent/index.js's sdk.useCamera()), and this
 * preview stream is never recorded, sent anywhere, or used for any
 * measurement. It's purely a visual aid.
 *
 * Because the agent and this browser tab may both be trying to use the
 * same physical webcam from two different processes, getUserMedia here
 * can fail even when the agent's own capture is working fine (or vice
 * versa) -- so failure here is treated as a normal, silent case: the
 * preview just doesn't render, and the rest of the capture flow (ring,
 * countdown, hint text) is completely unaffected.
 */
function useCameraPreview() {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [available, setAvailable] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(3 / 4);

  useEffect(() => {
    let activeStream;
    let cancelled = false;

    async function start() {
      try {
        activeStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          activeStream.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(activeStream);
        setAvailable(true);
      } catch (err) {
        // Expected in some setups (permission denied, or the presage-agent
        // process already holds the camera) -- not an error to surface to
        // the patient, just fall back to the non-video UI.
        console.warn("[kiosk] camera preview unavailable, falling back:", err.message);
        setAvailable(false);
      }
    }

    start();
    return () => {
      cancelled = true;
      activeStream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Attach the stream once BOTH the <video> element exists and the stream
  // is ready. The element is always mounted (see the render below) so this
  // doesn't race against a conditional render the way assigning inside the
  // getUserMedia callback directly did.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null;
  }, [stream]);

  return { videoRef, available, aspectRatio, setAspectRatio };
}

/**
 * Alignment guide drawn over the video preview: a white rounded-rectangle
 * outline (matching the reference look) plus a scanning line that sweeps
 * top-to-bottom for an "actively measuring" feel and pauses (color shifts
 * to the warning tone) when framing is bad. Purely decorative -- the
 * actual framing judgment comes from the agent's validationStatus stream
 * (surfaced here as `blocking`), not from anything detected in the browser.
 * viewBox is 300x400 (3:4) to match the .face-frame container's aspect
 * ratio, so it stretches to fill it exactly with no distortion.
 */
function AlignmentGuide({ blocking }) {
  const scanColor = blocking ? "var(--guide-warning, #e0a030)" : "var(--guide-ok, #2f6fb3)";

  return (
    <svg className="alignment-guide" viewBox="0 0 300 400" aria-hidden="true">
      <rect
        x="24"
        y="24"
        width="252"
        height="352"
        rx="28"
        ry="28"
        fill="none"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth="4"
      />
      <line
        className="alignment-scanline"
        x1="24"
        y1="0"
        x2="276"
        y2="0"
        stroke={scanColor}
        strokeWidth="4"
        style={{ animationPlayState: blocking ? "paused" : "running", transition: "stroke 200ms ease" }}
      />
    </svg>
  );
}

export default function Capture({ mode, durationMs, startedAt, saving, onCancel }) {
  const active = !!startedAt && !saving;
  const { secondsLeft, hint } = useCaptureProgress(active, startedAt, durationMs);
  const { videoRef, available: previewAvailable, aspectRatio, setAspectRatio } = useCameraPreview();
  const counting = secondsLeft != null && secondsLeft > 0 && !saving;
  const blocking = !!hint;

  let status;
  if (saving) status = "Saving your reading…";
  else if (secondsLeft == null) status = "Getting ready…";
  else if (blocking) status = "Countdown paused -- it continues when you're back in position";
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

      {previewAvailable ? (
        <>
          {/* Face frame: video + alignment guide only -- no progress ring
              wrapped around it. The countdown lives separately below. */}
          <div className="face-frame" style={{ aspectRatio }}>
            <video
              ref={videoRef}
              className="preview-video is-ready"
              autoPlay
              playsInline
              muted
              onLoadedMetadata={(event) => {
                const { videoWidth, videoHeight } = event.currentTarget;
                if (videoWidth && videoHeight) setAspectRatio(videoWidth / videoHeight);
              }}
              aria-hidden="true"
            />
            <AlignmentGuide blocking={blocking} />
          </div>

          <p className="align-caption">
            {blocking ? hint || "Adjust your position" : "Center your face in the frame"}
          </p>

          <div className="countdown-ring" aria-live="polite">
            <svg className="progress-ring" viewBox="0 0 200 200" aria-hidden="true">
              <circle className="ring-track" cx="100" cy="100" r={RADIUS} />
              {startedAt && (
                <circle
                  key={startedAt}
                  className="ring-progress"
                  cx="100"
                  cy="100"
                  r={RADIUS}
                  strokeDasharray={CIRCUMFERENCE}
                  style={{
                    "--circumference": CIRCUMFERENCE,
                    stroke: blocking ? "var(--guide-warning, #e0a030)" : undefined,
                    animationDuration: `${durationMs}ms`,
                    animationPlayState: blocking ? "paused" : "running",
                  }}
                />
              )}
            </svg>
            <div className="ring-label">
              {counting ? (
                <>
                  <span className="ring-seconds">{secondsLeft}</span>
                  <span className="ring-unit">{blocking ? "paused" : "seconds"}</span>
                </>
              ) : (
                <span className="ring-dots" aria-hidden="true">•••</span>
              )}
            </div>
          </div>
        </>
      ) : (
        // Fallback when the browser preview isn't available (permission
        // denied, or the camera's already in use by the presage-agent
        // process) -- the original single ring, no video, unchanged.
        <div className="ring" aria-live="polite">
          {/* Always mounted so the ref exists before the getUserMedia
              stream resolves, even though it stays hidden/unused on this
              branch -- keeps useCameraPreview's ref logic simple regardless
              of which branch ends up rendering. */}
          <video ref={videoRef} className="preview-video" autoPlay playsInline muted aria-hidden="true" />

          <svg className="progress-ring" viewBox="0 0 200 200" aria-hidden="true">
            <circle className="ring-track" cx="100" cy="100" r={RADIUS} />
            {startedAt && (
              <circle
                key={startedAt}
                className="ring-progress"
                cx="100"
                cy="100"
                r={RADIUS}
                strokeDasharray={CIRCUMFERENCE}
                style={{
                  "--circumference": CIRCUMFERENCE,
                  stroke: blocking ? "var(--guide-warning, #e0a030)" : undefined,
                  animationDuration: `${durationMs}ms`,
                  animationPlayState: blocking ? "paused" : "running",
                }}
              />
            )}
          </svg>

          <div className="ring-label">
            {counting ? (
              <>
                <span className="ring-seconds">{secondsLeft}</span>
                <span className="ring-unit">{blocking ? "paused" : "seconds"}</span>
              </>
            ) : (
              <span className="ring-dots" aria-hidden="true">•••</span>
            )}
          </div>
        </div>
      )}

      <p className="status">{status}</p>

      {/* Poor framing pauses the countdown (the agent only counts good
          seconds) -- say so, so a stopped timer doesn't look like a hang. */}
      {blocking && !saving && (
        <div className="paused-notice" role="status" aria-live="polite">
          <strong>Paused.</strong> {hint.replace(/\.\s*$/, "")}. The countdown picks up again as soon as you're back in position -- no need
          to start over.
        </div>
      )}

      {!saving && (
        <button className="text-button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </main>
  );
}