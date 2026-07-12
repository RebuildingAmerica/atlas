import { useSyncExternalStore } from "react";

/**
 * Subscribe to nothing -- the store never changes. This is a no-op used only
 * to distinguish server-side rendering from the hydrated browser render.
 */
function subscribeNoop() {
  return () => undefined;
}

/**
 * Returns `true` after browser hydration and `false` during SSR.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}
