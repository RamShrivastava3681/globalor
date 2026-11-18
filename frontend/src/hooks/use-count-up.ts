import { useEffect, useRef, useState } from "react";

/**
 * Animates a numeric value from 0 to `target` over `duration` ms.
 * Uses requestAnimationFrame with ease-out cubic easing for smooth animation.
 * On first render (mount), animates from 0. On subsequent target changes,
 * snaps to the new value immediately to avoid sluggish re-render animations.
 */
export function useCountUp(target: number, duration = 300, enabled = true) {
  const [value, setValue] = useState(target); // start at target, not 0
  const frameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!enabled || target === 0) {
      setValue(target);
      return;
    }

    // Only animate on the very first mount; subsequent updates snap instantly
    if (mountedRef.current) {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      setValue(target);
      return;
    }
    mountedRef.current = true;

    const startValue = 0;
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
