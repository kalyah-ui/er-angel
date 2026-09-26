/**
 * Automatic recheck reminders -- all the timing rules, as pure functions.
 * Every duration is multiplied by RECHECK_TIME_SCALE (backend/.env, default
 * 1); e.g. 0.07 turns 15/20/30 min into ~1-2 min for a live demo.
 */
export const RECHECK_CONFIG = {
  // How long after their latest reading a patient is due for a recheck, by latest risk level.
  intervalMinutes: { high: 15, medium: 20, low: 30 },
  // Unanswered reminder -> remind again after this long; give up after maxReminders.
  reminderGapMinutes: 5,
  maxReminders: 2,
};

let warnedBadScale = false;

export function recheckTimeScale() {
  const raw = process.env.RECHECK_TIME_SCALE;
  if (raw == null || raw.trim() === "") return 1;
  const scale = Number(raw);
  if (Number.isFinite(scale) && scale > 0) return scale;
  if (!warnedBadScale) console.warn(`[recheck] ignoring invalid RECHECK_TIME_SCALE="${raw}" -- using 1`);
  warnedBadScale = true;
  return 1;
}

const minutesToMs = (minutes, scale) => minutes * 60000 * scale;

/**
 * Where a patient stands on rechecks.
 *
 * @param {object} p
 * @param {Date|null} p.latestReadingAt   their most recent reading (any kind)
 * @param {string|null} p.riskLevel       latest alert's risk level; null = no alert
 * @param {Date[]} p.remindersSince        recheck calls made since that reading, oldest first
 * @param {boolean} p.calledToTriage       a nurse called them to triage since that reading
 * @param {Date} p.now
 * @param {number} [p.scale]
 * @returns {{ next_recheck_at: Date|null, recheck_due: boolean, missed_recheck: boolean, remind: boolean, reminders_sent: number }}
 *   `remind` = the scheduler should send a reminder now.
 */
export function recheckStatus({ latestReadingAt, riskLevel, remindersSince, calledToTriage, now, scale = recheckTimeScale() }) {
  const reminders_sent = remindersSince.length;
  // No reading yet, or already called to the triage desk: no reminders.
  if (!latestReadingAt || calledToTriage) {
    return { next_recheck_at: null, recheck_due: false, missed_recheck: false, remind: false, reminders_sent };
  }

  const { intervalMinutes, reminderGapMinutes, maxReminders } = RECHECK_CONFIG;
  const interval = intervalMinutes[riskLevel] ?? intervalMinutes.low;
  const nextRecheckAt = new Date(latestReadingAt.getTime() + minutesToMs(interval, scale));
  const gapMs = minutesToMs(reminderGapMinutes, scale);
  const lastReminder = remindersSince[reminders_sent - 1];
  const gapPassed = lastReminder != null && now.getTime() >= lastReminder.getTime() + gapMs;

  return {
    next_recheck_at: nextRecheckAt,
    recheck_due: now >= nextRecheckAt,
    // Every reminder went unanswered for a full gap.
    missed_recheck: reminders_sent >= maxReminders && gapPassed,
    remind: reminders_sent === 0 ? now >= nextRecheckAt : reminders_sent < maxReminders && gapPassed,
    reminders_sent,
  };
}
