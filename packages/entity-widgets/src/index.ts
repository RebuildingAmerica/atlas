/**
 * Public surface for `@rebuildingamerica/entity-widgets`'s library build.
 *
 * `app/` imports from here. Widget-build-only internals — the
 * `useEntityCardData`/`useSearchResultsData` hooks and the `App`
 * host-communication plumbing in `src/adapters/app-client.ts`, and the
 * mount entries in `src/widget-entries/` — are deliberately not exported:
 * `app/` fetches its own data and passes presentation-typed props (e.g.
 * `EntityCardData`, `SearchResultsData`) to these components directly.
 */
export {
  ConnectionsGraph,
  type ConnectionsGraphProps,
} from "./components/connections-graph/connections-graph";
export {
  EntityCard,
  type EntityCardProps,
} from "./components/entity-card/entity-card";
export {
  SearchResultsList,
  type SearchResultsListProps,
} from "./components/search-results-list/search-results-list";
export {
  TrustBadgeRow,
  type TrustBadgeRowProps,
} from "./components/trust-badge-row/trust-badge-row";
export { WidgetStatus, type WidgetStatusProps } from "./lib/widget-status";
export type {
  ConnectionItem,
  ConnectionRelationship,
  ConnectionsData,
  EntityCardData,
  EntityType,
  SearchResultRow,
  SearchResultsData,
  TrustLevel,
} from "./types";
