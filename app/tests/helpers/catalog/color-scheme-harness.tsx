import { vi } from "vitest";
import { useDeviceColorScheme } from "@/domains/catalog/hooks/use-device-color-scheme";

export function createColorSchemeControl() {
  let currentMatches = false;
  let listeners: (() => void)[] = [];
  let lastQuery: string | null = null;

  return {
    install: (matches: boolean) => {
      currentMatches = matches;
      listeners = [];
      window.matchMedia = vi.fn((query: string): MediaQueryList => {
        lastQuery = query;
        return {
          matches: currentMatches,
          addEventListener: (_type: string, listener: () => void) => {
            listeners.push(listener);
          },
          removeEventListener: (_type: string, listener: () => void) => {
            listeners = listeners.filter((entry) => entry !== listener);
          },
        } as unknown as MediaQueryList;
      });
    },
    emitChange: (matches: boolean) => {
      currentMatches = matches;
      for (const listener of listeners) {
        listener();
      }
    },
    lastQuery: () => lastQuery,
    listenerCount: () => listeners.length,
  };
}

export function SchemeReader() {
  const scheme = useDeviceColorScheme();
  return <output aria-label="Device color scheme">{scheme}</output>;
}
