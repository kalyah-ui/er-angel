import { fetchPendingCalls, markCallAnnounced } from "../api/client.js";
import { ANNOUNCEMENTS } from "./voiceLines.js";
import { isPromptPlaying, playAnnouncement, stopVoice } from "./voice.js";

const POLL_MS = 3000;
const BANNER_MIN_MS = 15000;
const GAP_BETWEEN_MS = 1500;
const TYPE_PRIORITY = { triage: 0, recheck: 1 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function byPriority(a, b) {
  return (
    (TYPE_PRIORITY[a.type] ?? 9) - (TYPE_PRIORITY[b.type] ?? 9) ||
    a.created_at.localeCompare(b.created_at) ||
    a.id - b.id
  );
}

/**
 * Kiosk PA system. Polls GET /calls/pending and announces calls one at a
 * time, triage before recheck: shows the banner right away, speaks the line
 * twice once the kiosk is quiet (never during a capture or over a screen
 * prompt), keeps the banner up for ~15s, then marks the call announced.
 *
 * @param {() => boolean} isCapturing  true while the capture screen is up
 * @param {(banner: null | { id, type, text }) => void} onBanner
 * @returns {() => void} stop
 */
export function startAnnouncer({ isCapturing, onBanner, pollMs = POLL_MS, bannerMinMs = BANNER_MIN_MS, gapMs = GAP_BETWEEN_MS }) {
  let stopped = false;
  const queue = [];
  const seen = new Set(); // queued or handled this session
  const finished = new Set(); // announced; retry the POST if it didn't stick
  let loggedDown = false;
  let speaking = false;

  async function poll() {
    try {
      const pending = await fetchPendingCalls();
      loggedDown = false;
      for (const call of pending) {
        if (finished.has(call.id)) {
          markCallAnnounced(call.id).catch(() => {});
        } else if (!seen.has(call.id)) {
          seen.add(call.id);
          queue.push(call);
        }
      }
      queue.sort(byPriority);
    } catch (err) {
      if (!loggedDown) console.warn("[announcer] can't reach backend for calls:", err.message);
      loggedDown = true;
    }
  }

  async function announce(call) {
    const lines = ANNOUNCEMENTS[call.type];
    if (!lines) {
      console.warn(`[announcer] unknown call type "${call.type}" -- skipping call ${call.id}`);
      return;
    }

    const shownAt = Date.now();
    onBanner({ id: call.id, type: call.type, text: lines.banner(call.patient_id) });
    console.info(`[announcer] ${call.type} call ${call.id}: patient #${call.patient_id}`);

    // Speak once the kiosk is quiet. A capture starting mid-announcement
    // interrupts it (returns false), so we wait and say it again after.
    let spoken = false;
    while (!stopped && !spoken) {
      if (isCapturing() || isPromptPlaying()) {
        await sleep(300);
        continue;
      }
      speaking = true;
      spoken = await playAnnouncement(lines.spoken(call.patient_id));
      speaking = false;
    }

    const remaining = bannerMinMs - (Date.now() - shownAt);
    if (remaining > 0) await sleep(remaining);
  }

  async function run() {
    while (!stopped) {
      const call = queue.shift();
      if (!call) {
        await sleep(300);
        continue;
      }
      await announce(call);
      if (stopped) return;
      onBanner(null);
      finished.add(call.id);
      await markCallAnnounced(call.id).catch((err) =>
        console.warn(`[announcer] couldn't mark call ${call.id} announced (will retry):`, err.message)
      );
      await sleep(gapMs);
    }
  }

  poll();
  const pollTimer = setInterval(poll, pollMs);
  run();

  return () => {
    stopped = true;
    clearInterval(pollTimer);
    if (speaking) stopVoice(); // don't leave an announcement talking after we stop
  };
}
