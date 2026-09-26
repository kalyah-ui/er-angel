import { useCallback, useEffect, useRef, useState } from "react";
import { startAnnouncer } from "./announcer.js";

/**
 * React wrapper around the kiosk PA announcer (announcer.js).
 * @param {boolean} capturing  true while the capture screen is up
 * @returns {{ banner: null | { id, type, text }, pollNow: () => void }}
 *   pollNow picks up a just-created call without waiting for the next poll.
 */
export function useAnnouncer(capturing) {
  const [banner, setBanner] = useState(null);
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;
  const announcer = useRef(null);

  useEffect(() => {
    announcer.current = startAnnouncer({ isCapturing: () => capturingRef.current, onBanner: setBanner });
    return () => announcer.current.stop();
  }, []);

  const pollNow = useCallback(() => announcer.current?.pollNow(), []);
  return { banner, pollNow };
}
