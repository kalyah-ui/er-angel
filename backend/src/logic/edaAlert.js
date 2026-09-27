const ROLLING_WINDOW_SIZE = 5;
const RISING_CHECKINS_REQUIRED = 3;

// EDA (stress_score) may only escalate a rescan -- and only to "medium" --
// when heart rate or breathing rate has also risen meaningfully since the
// triage baseline. Smaller moves are normal jitter and never count.
export const EDA_ESCALATION = {
  minHeartRateRise: 10, // bpm above baseline
  minBreathingRateRise: 4, // breaths/min above baseline
};

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * Has HR or RR risen enough since the triage baseline for EDA to escalate?
 * Missing (null) values never count as a rise.
 */
export function meaningfulVitalsRise({ baseline, current }) {
  const hrRise = isNumber(baseline?.heart_rate) && isNumber(current?.heart_rate) ? current.heart_rate - baseline.heart_rate : null;
  const rrRise =
    isNumber(baseline?.breathing_rate) && isNumber(current?.breathing_rate) ? current.breathing_rate - baseline.breathing_rate : null;
  const heartRate = hrRise !== null && hrRise >= EDA_ESCALATION.minHeartRateRise;
  const breathingRate = rrRise !== null && rrRise >= EDA_ESCALATION.minBreathingRateRise;
  return { heartRate, breathingRate, any: heartRate || breathingRate, hrRise, rrRise };
}

export function evaluateEdaAlert({ current, history }) {
  const previousReadings = history || [];
  const previousEdaValues = previousReadings
    .map((reading) => reading.stress_score)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const rollingValues = previousEdaValues.slice(-ROLLING_WINDOW_SIZE);
  const rollingBaseline = rollingValues.length
    ? rollingValues.reduce((sum, value) => sum + value, 0) / rollingValues.length
    : null;
  const currentEda = current.stress_score;
  const percentAboveBaseline = rollingBaseline > 0 && typeof currentEda === "number"
    ? ((currentEda - rollingBaseline) / rollingBaseline) * 100
    : null;

  const edaSeries = [...previousReadings.map((reading) => reading.stress_score), currentEda];
  const recentSeries = edaSeries.slice(-(RISING_CHECKINS_REQUIRED + 1));
  const risingForThreeCheckins = recentSeries.length === RISING_CHECKINS_REQUIRED + 1
    && recentSeries.every((value, index) => typeof value === "number"
      && Number.isFinite(value)
      && (index === 0 || value > recentSeries[index - 1]));

  const previousReading = previousReadings.at(-1);
  const heartRateIncreasing = typeof current.heart_rate === "number"
    && typeof previousReading?.heart_rate === "number"
    && current.heart_rate > previousReading.heart_rate;
  const breathingRateIncreasing = typeof current.breathing_rate === "number"
    && typeof previousReading?.breathing_rate === "number"
    && current.breathing_rate > previousReading.breathing_rate;
  const accompanyingVitalsIncreasing = heartRateIncreasing || breathingRateIncreasing;

  const aboveBaseline = percentAboveBaseline !== null && percentAboveBaseline >= 50 - 1e-9;

  return {
    triggered: aboveBaseline || risingForThreeCheckins,
    aboveBaseline,
    risingForThreeCheckins,
    rollingBaseline,
    percentAboveBaseline,
    heartRateIncreasing,
    breathingRateIncreasing,
    accompanyingVitalsIncreasing,
  };
}