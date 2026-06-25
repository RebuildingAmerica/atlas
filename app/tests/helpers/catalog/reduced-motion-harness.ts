import { vi } from "vitest";

/** The shape of a media-query change event the listeners receive. */
interface FakeMediaChange {
  matches: boolean;
}

/** A controllable stand-in for `window.matchMedia` used by reduced-motion tests. */
export interface ReducedMotionControl {
  /** Install the fake `matchMedia` whose result starts at `matches`. */
  install: (matches: boolean) => void;
  /** Push a live preference change through every registered listener. */
  emitChange: (matches: boolean) => void;
  /** The most recent query string passed to `matchMedia`. */
  lastQuery: () => string | null;
  /** How many change listeners are currently registered. */
  listenerCount: () => number;
}

/**
 * Build a controllable `window.matchMedia` for the reduced-motion hook tests.
 *
 * The returned control installs a fake media-query list, lets a test flip the
 * preference live, and exposes the query string and listener count so a test can
 * assert the hook queried the right media and tore its listener down on unmount.
 */
export function createReducedMotionControl(): ReducedMotionControl {
  let currentMatches = false;
  let listeners: ((event: FakeMediaChange) => void)[] = [];
  let lastQuery: string | null = null;

  return {
    install: (matches) => {
      currentMatches = matches;
      listeners = [];
      window.matchMedia = vi.fn((query: string): MediaQueryList => {
        lastQuery = query;
        return {
          matches: currentMatches,
          addEventListener: (_type: string, listener: (event: FakeMediaChange) => void) => {
            listeners.push(listener);
          },
          removeEventListener: (_type: string, listener: (event: FakeMediaChange) => void) => {
            listeners = listeners.filter((entry) => entry !== listener);
          },
        } as unknown as MediaQueryList;
      });
    },
    emitChange: (matches) => {
      currentMatches = matches;
      for (const listener of listeners) {
        listener({ matches });
      }
    },
    lastQuery: () => lastQuery,
    listenerCount: () => listeners.length,
  };
}
