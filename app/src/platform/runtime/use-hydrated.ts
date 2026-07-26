/**
 * App-facing seam for the shared hydration signal.
 *
 * The implementation lives in `atlas-ui` so code outside `app/` -- the shared
 * date-time formatter, for one -- can read the same signal. Keeping this module
 * as the app's import path lets app tests stub hydration without reaching into
 * the shared package.
 */
export { useHydrated } from "@rebuildingamerica/atlas-ui/hooks/use-hydrated";
