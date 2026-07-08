import { useEffect, useRef, useState } from "react";

/**
 * Animates a numeric value from 0 to `target` over `duration` ms.
 * Uses requestAnimationFrame with ease-out cubic easing for smooth animation.
 */
export function useCountUp(target: number, duration = 800, enabled = true) {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const prevTargetRef = useRef(target);

  useEffect(() => {
    if (!enabled || target === 0) {
      setValue(target);
      return;
    }

    // If target changed while animating, restart from current value
    const startValue = prevTargetRef.current !== target ? value : 0;
    prevTargetRef.current = target;
    startTimeRef.current = 0;

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Cubic ease-out
      const eased = 1 - Math.pow(1 - progress, 3);

      const current = startValue + (target - startValue) * eased;
      setValue(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        setValue(target);
      }
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration, enabled]);

  return value;
}
