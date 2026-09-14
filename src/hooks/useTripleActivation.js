import { useCallback, useEffect, useRef } from "react";

const GESTURE_WINDOW_MS = 1200;

export default function useTripleActivation(onTripleActivate) {
  const activationCount = useRef(0);

  const timer = useRef(null);

  const clearGesture = useCallback(() => {
    activationCount.current = 0;

    if (timer.current !== null) {
      clearTimeout(timer.current);

      timer.current = null;
    }
  }, []);

  useEffect(() => clearGesture, [clearGesture]);

  return useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }

    activationCount.current += 1;

    if (activationCount.current >= 3) {
      clearGesture();

      onTripleActivate();

      return true;
    }

    timer.current = setTimeout(clearGesture, GESTURE_WINDOW_MS);

    return false;
  }, [clearGesture, onTripleActivate]);
}
