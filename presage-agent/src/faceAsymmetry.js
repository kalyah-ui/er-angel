// Landmark indices have been visually cross-checked against the
// MediaPipe Face Mesh reference map (478-point model).
//
// 33  = right outer eye corner
// 263 = left outer eye corner
// 61  = right mouth corner
// 291 = left mouth corner
//
// These landmarks form symmetric bilateral pairs suitable for
// head-tilt-normalized facial asymmetry measurements.

const LANDMARK = {
  // Outer eye corners
  EYE_RIGHT_OUTER: 33,
  EYE_LEFT_OUTER: 263,

  // Mouth landmarks (right side)
  MOUTH_RIGHT_OUTER: 61,
  MOUTH_RIGHT_UPPER: 40,
  MOUTH_RIGHT_LOWER: 91,

  // Mouth landmarks (left side)
  MOUTH_LEFT_OUTER: 291,
  MOUTH_LEFT_UPPER: 270,
  MOUTH_LEFT_LOWER: 321,

  // Approximate facial center
  NOSE_TIP: 1,
};

/**
 * @param {Array<{x:number,y:number}>} landmarks
 * @returns {number|null}
 */
export function computeAsymmetryScore(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 322) {
    return null;
  }

  const eyeR = landmarks[LANDMARK.EYE_RIGHT_OUTER];
  const eyeL = landmarks[LANDMARK.EYE_LEFT_OUTER];

  const nose = landmarks[LANDMARK.NOSE_TIP];

  const rightPoints = [
    landmarks[LANDMARK.MOUTH_RIGHT_OUTER],
    landmarks[LANDMARK.MOUTH_RIGHT_UPPER],
    landmarks[LANDMARK.MOUTH_RIGHT_LOWER],
  ];

  const leftPoints = [
    landmarks[LANDMARK.MOUTH_LEFT_OUTER],
    landmarks[LANDMARK.MOUTH_LEFT_UPPER],
    landmarks[LANDMARK.MOUTH_LEFT_LOWER],
  ];

  if (
    !eyeR ||
    !eyeL ||
    !nose ||
    rightPoints.some((p) => !p) ||
    leftPoints.some((p) => !p)
  ) {
    return null;
  }

  const eyeDx = eyeL.x - eyeR.x;
  const eyeDy = eyeL.y - eyeR.y;

  const interEyeDist = Math.hypot(eyeDx, eyeDy);

  if (interEyeDist < 1e-6) {
    return null;
  }

  const tiltAngle = Math.atan2(eyeDy, eyeDx);

  const midX = (eyeR.x + eyeL.x) / 2;
  const midY = (eyeR.y + eyeL.y) / 2;

  const cos = Math.cos(-tiltAngle);
  const sin = Math.sin(-tiltAngle);

  function rotate(point) {
    const dx = point.x - midX;
    const dy = point.y - midY;

    return {
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos,
    };
  }

  function averagePoint(points) {
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
  }

  const mouthRight = averagePoint(rightPoints);
  const mouthLeft = averagePoint(leftPoints);

  const mouthRightRot = rotate(mouthRight);
  const mouthLeftRot = rotate(mouthLeft);
  const noseRot = rotate(nose);

  // FAST-style droop indicator
  const verticalAsymmetry =
    Math.abs(mouthRightRot.y - mouthLeftRot.y) /
    interEyeDist;

  // Compare both sides against the facial midline
  const rightDistanceFromMidline =
    Math.abs(mouthRightRot.x - noseRot.x);

  const leftDistanceFromMidline =
    Math.abs(mouthLeftRot.x - noseRot.x);

  const horizontalAsymmetry =
    Math.abs(
      rightDistanceFromMidline - leftDistanceFromMidline
    ) / interEyeDist;

  // Vertical droop is usually the clinically stronger signal
  const score =
    verticalAsymmetry * 0.7 +
    horizontalAsymmetry * 0.3;

  return score;
}

/**
 * Convenience: average the asymmetry score across several landmark
 * samples from one capture window, ignoring frames where landmarks
 * weren't detected.
 * @param {Array<Array<{x:number,y:number}>>} landmarkSamples
 */
/**
 * @param {Array<Array<{x:number,y:number}>>} landmarkSamples
 * @returns {number|null}
 */
export function averageAsymmetryScore(landmarkSamples) {
  if (!Array.isArray(landmarkSamples)) {
    return null;
  }

  const scores = landmarkSamples
    .map(computeAsymmetryScore)
    .filter(
      (score) =>
        typeof score === "number" &&
        Number.isFinite(score)
    );

  if (scores.length === 0) {
    return null;
  }

  return (
    scores.reduce((sum, score) => sum + score, 0) /
    scores.length
  );
}