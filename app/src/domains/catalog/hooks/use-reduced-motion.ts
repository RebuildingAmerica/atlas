import { useEffect, useState } from "react";

/** The media query that asks whether the visitor wants animation kept to a minimum. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Track the visitor's `prefers-reduced-motion` setting, live.
 *
 * The map's reveal, fly-to arcs, cluster bloom, and panel slide are all gated on
 * this so a visitor who has asked their system to calm motion gets fades and
 * jumps instead of sweeps. The value follows the setting in real time — a person
 * toggling it mid-session is honored without a reload — and the listener is torn
 * down on unmount so nothing leaks.
 *
 * @returns Whether the visitor currently prefers reduced motion.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    setReducedMotion(media.matches);
    const onChange = (event: MediaQueryListEvent): void => {
      setReducedMotion(event.matches);
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);

  return reducedMotion;
}
