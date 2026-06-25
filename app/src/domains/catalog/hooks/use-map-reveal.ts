import { useEffect, useState } from "react";

/** Session-storage flag marking that the first-load reveal has already played. */
export const MAP_REVEAL_SESSION_KEY = "atlas-map-revealed";

/** How long the basemap fades in before the chrome rises over it, in ms. */
export const REVEAL_BASEMAP_FADE_MS = 400;

/** The truthy marker stored once the reveal has run this session. */
const REVEAL_PLAYED = "1";

interface UseMapRevealOptions {
  /** Show everything at once, skipping the staged reveal entirely. */
  reducedMotion?: boolean;
}

/** The reveal's two observable signals for the surrounding chrome and clusters. */
export interface MapRevealState {
  /** True while the staged reveal is running (clusters scale in, chrome waits). */
  playing: boolean;
  /** True once the chrome should be visible — immediately, or after the fade. */
  chromeRevealed: boolean;
}

/** Whether the reveal has already played in this browser session. */
function hasRevealedThisSession(): boolean {
  return window.sessionStorage.getItem(MAP_REVEAL_SESSION_KEY) === REVEAL_PLAYED;
}

/** Remember that the reveal has played so later mounts this session skip it. */
function markRevealed(): void {
  window.sessionStorage.setItem(MAP_REVEAL_SESSION_KEY, REVEAL_PLAYED);
}

/**
 * Orchestrate the map's first-load reveal — once per session.
 *
 * On a visitor's first arrival the basemap fades in, the clusters scale into
 * place, and only then does the floating chrome (command bar, legend, controls)
 * rise — a calm, deliberate "here is the country, and here is the work."
 * Returning to the map later in the same session is instant: the reveal is a
 * welcome, not a tax on every visit. Reduced-motion visitors always get the
 * finished state immediately.
 *
 * @param options Motion preferences.
 * @returns Whether the reveal is playing and whether the chrome should show.
 */
export function useMapReveal(options?: UseMapRevealOptions): MapRevealState {
  const reducedMotion = options?.reducedMotion ?? false;
  const [state, setState] = useState<MapRevealState>(() => {
    if (reducedMotion || hasRevealedThisSession()) {
      return { playing: false, chromeRevealed: true };
    }
    return { playing: true, chromeRevealed: false };
  });

  useEffect(() => {
    if (!state.playing) {
      markRevealed();
      return;
    }
    const handle = window.setTimeout(() => {
      setState({ playing: false, chromeRevealed: true });
      markRevealed();
    }, REVEAL_BASEMAP_FADE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [state.playing]);

  return state;
}
