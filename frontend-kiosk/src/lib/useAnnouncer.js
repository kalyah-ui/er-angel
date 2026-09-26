import { useEffect, useRef, useState } from "react";
import { startAnnouncer } from "./announcer.js";

/**
 * React wrapper around the kiosk PA announcer (announcer.js).
 * @param {boolean} capturing  true while the capture screen is up
 * @returns {null | { id, type, text }} the banner to show
 */
export function useAnnouncer(capturing) {
  const [banner, setBanner] = useState(null);
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;

  useEffect(() => startAnnouncer({ isCapturing: () => capturingRef.current, onBanner: setBanner }), []);

  return banner;
}
