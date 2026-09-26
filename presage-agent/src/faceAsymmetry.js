/**
 * Facial asymmetry scoring, inspired by the "F" (Face) in the FAST stroke
 * screening protocol (Face, Arms, Speech, Time). This computes a
 * lightweight symmetry score from face landmarks -- NOT a diagnosis, a
 * supplementary signal for a nurse to look at.
 *
 * IMPORTANT: this is meant to be compared against a PATIENT'S OWN baseline,
 * not an absolute population threshold. Everyone has some natural facial
 * asymmetry; what matters clinically is a SUDDEN CHANGE from someone's own
 * resting face. See services/geminiRisk.js on the backend for how this
 * baseline-vs-current comparison is wired in, same pattern as heart rate.
 *
 * Landmark indices below use the standard MediaPipe Face Mesh numbering
 * (468 base points + 10 iris points = 478, matching Presage's "478 facial
 * landmark coordinates" description). These specific index numbers are
 * widely documented for MediaPipe but have NOT been visually confirmed
 * against Presage's own landmark reference image
 * (https://storage.googleapis.com/mediapipe-assets/documentation/mediapipe_face_landmark_fullsize.png).
 * Cross-check them against that image before trusting the output, and
 * adjust the constants below if needed.
 */

const LANDMARK = {
  // Mouth corners -- the primary FAST-relevant points (facial droop shows
  // up here first and most visibly).
  MOUTH_RIGHT: 61,
  MOUTH_LEFT: 291,

  // Eye outer corners -- used to build a stable reference line so head
  // tilt doesn't get misread as facial asymmetry.
  EYE_RIGHT_OUTER: 33,
  EYE_LEFT_OUTER: 263,
};

/**
 * @param {Array<{x: number, y: number}>} landmarks  raw landmark array, index-aligned to MediaPipe numbering
 * @returns {number|null} asymmetry score, roughly 0 (symmetric) to higher values (more asymmetric),
 *   normalized by inter-eye distance so it's comparable across different distances from the camera.
 *   Returns null if required landmarks are missing/low quality.
 */
export function computeAsymmetryScore(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 292) return null;

  const mouthR = landmarks[LANDMARK.MOUTH_RIGHT];
  const mouthL = landmarks[LANDMARK.MOUTH_LEFT];
  const eyeR = landmarks[LANDMARK.EYE_RIGHT_OUTER];
  const eyeL = landmarks[LANDMARK.EYE_LEFT_OUTER];

  if (!mouthR || !mouthL || !eyeR || !eyeL) return null;

  // 1. Build a reference line from the two outer eye corners and find the
  //    angle needed to "level" the face -- corrects for head tilt so a
  //    tilted head isn't mistaken for facial droop.
  const eyeDx = eyeL.x - eyeR.x;
  const eyeDy = eyeL.y - eyeR.y;
  const tiltAngle = Math.atan2(eyeDy, eyeDx);

  const interEyeDist = Math.hypot(eyeDx, eyeDy);
  if (interEyeDist === 0) return null; // degenerate/invalid frame

  // 2. Rotate the mouth corner points by -tiltAngle around the eye
  //    midpoint, so the eye line becomes perfectly horizontal.
  const midX = (eyeR.x + eyeL.x) / 2;
  const midY = (eyeR.y + eyeL.y) / 2;

  function rotate(point) {
    const dx = point.x - midX;
    const dy = point.y - midY;
    const cos = Math.cos(-tiltAngle);
    const sin = Math.sin(-tiltAngle);
    return {
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos,
    };
  }

  const mouthRRot = rotate(mouthR);
  const mouthLRot = rotate(mouthL);

  // 3. After leveling, a symmetric face has both mouth corners at
  //    roughly the same height (y). Facial droop on one side shows up as
  //    a vertical offset between them. Normalize by inter-eye distance so
  //    the score doesn't depend on how close the patient is to the camera.
  const verticalDelta = Math.abs(mouthRRot.y - mouthLRot.y);
  const score = verticalDelta / interEyeDist;

  return score;
}

/**
 * Convenience: average the asymmetry score across several landmark
 * samples from one capture window, ignoring frames where landmarks
 * weren't detected.
 * @param {Array<Array<{x:number,y:number}>>} landmarkSamples
 */
export function averageAsymmetryScore(landmarkSamples) {
  const scores = landmarkSamples
    .map(computeAsymmetryScore)
    .filter((s) => typeof s === "number" && !Number.isNaN(s));

  if (!scores.length) return null;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}