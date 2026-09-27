import { useEffect, useRef, useState } from "react";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Animate a number from its previous value to the new one (ease-out). Non-numbers pass through.
export function useCountUp(value, duration = 700) {
  const [shown, setShown] = useState(value);
  const from = useRef(typeof value === "number" ? 0 : value);

  useEffect(() => {
    if (typeof value !== "number" || prefersReducedMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = typeof from.current === "number" ? from.current : 0;
    if (start === value) return;
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    // rAF is paused while the page isn't painted (screen off, background tab); never leave a stale number.
    const settle = setTimeout(() => {
      cancelAnimationFrame(raf);
      setShown(value);
      from.current = value;
    }, duration + 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      from.current = value;
    };
  }, [value, duration]);

  return shown;
}
