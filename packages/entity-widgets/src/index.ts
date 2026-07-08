/**
 * Public surface for `@rebuildingamerica/entity-widgets`'s library build.
 *
 * `app/` imports from here. Widget-build-only internals — the
 * `useEntityCardData`/`useSearchResultsData` hooks and the `App`
 * host-communication plumbing, and the mount entries — live in the sibling
 * `entity-widgets-mcp` package, not this one: `app/` fetches its own data
 * and passes presentation-typed props (e.g. `EntityCardData`,
 * `SearchResultsData`) to these components directly.
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
  ConnectionsData,
} from "./components/connections-graph/connections-graph";
export type { ConnectionRelationship } from "./lib/relationship-labels";
export type { EntityCardData } from "./components/entity-card/entity-card";
export type {
  SearchResultRow,
  SearchResultsData,
} from "./components/search-results-list/search-results-list";
export type { EntityType } from "./lib/entity-type-labels";
export type { TrustLevel } from "./components/trust-badge-row/trust-badge-row";
