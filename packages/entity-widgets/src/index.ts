/**
 * Public surface for `@rebuildingamerica/entity-widgets`'s library build.
 *
 * `app/` imports from here. Widget-build-only internals — the
 * `useEntityCardData` hook and the `App` host-communication plumbing in
 * `src/adapters/app-client.ts`, and the mount entry in
 * `src/widget-entries/` — are deliberately not exported: `app/` fetches its
 * own data and passes `EntityCardData`-shaped props to `EntityCard` directly.
 */
export {
  EntityCard,
  type EntityCardProps,
} from "./components/entity-card/entity-card";
export {
  TrustBadgeRow,
  type TrustBadgeRowProps,
} from "./components/trust-badge-row/trust-badge-row";
export type { EntityCardData, EntityType, TrustLevel } from "./types";
