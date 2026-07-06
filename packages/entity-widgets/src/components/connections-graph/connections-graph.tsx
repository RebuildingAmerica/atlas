import type { ConnectionItem, ConnectionsData } from "../../types";
import { formatEntityTypeAndPlace } from "../../lib/entity-type-labels";
import { formatRelationshipLabel } from "../../lib/relationship-labels";
import { TrustBadgeRow } from "../trust-badge-row/trust-badge-row";

export interface ConnectionsGraphProps {
  data: ConnectionsData;
  /**
   * Fetch and append the next page. Returns a `Promise` (mirrors
   * `useConnectionsData`'s `loadMore`) — the button's `onClick` wraps the
   * call in `void` rather than passing it directly, so a rejected promise
   * can never surface as an unhandled rejection from a native DOM event
   * handler.
   */
  onLoadMore: () => Promise<void>;
  isLoadingMore: boolean;
}

export interface ConnectionRowItemProps {
  item: ConnectionItem;
}

/**
 * One related-entity row: name, a "Type · City, State" one-liner, a trust
 * indicator, and — unlike a plain `SearchResultRowItem` — a row of small
 * pill tags naming every relationship this entity shares with the subject
 * entity (e.g. "Same organization", "Shared issue: Housing"). A related
 * entity can carry more than one relationship at once, so this renders one
 * pill per relationship rather than assuming exactly one.
 */
function ConnectionRowItem({ item }: ConnectionRowItemProps) {
  return (
    <li className="border-ew-border flex flex-col gap-1.5 border-b py-3 last:border-b-0">
      <div className="flex flex-col gap-1 @sm:flex-row @sm:items-center @sm:justify-between @sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-ew-ink truncate text-sm font-semibold">
            {item.entity.name}
          </p>
          <p className="text-ew-ink-soft text-xs">
            {formatEntityTypeAndPlace(item.entity)}
          </p>
        </div>
        <TrustBadgeRow
          verificationLevel={item.entity.trust_level}
          sourceCount={item.entity.source_count}
        />
      </div>

      {item.relationships.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {item.relationships.map((relationship, index) => (
            <span
              key={`${relationship.type}-${index}`}
              className="bg-ew-muted text-ew-muted-ink inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            >
              {formatRelationshipLabel(relationship)}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Compact, scannable list of related-entity rows for the
 * `get_related_entities` MCP Apps widget: one row per related entity (name,
 * type/location, a trust indicator reused from `TrustBadgeRow`, and a set of
 * relationship-type pill tags), a "Showing N of TOTAL" count, and a "Load
 * more" button when there's a further page (`data.next_cursor !== null`).
 *
 * Deliberately a labeled list, not a node-link/force-directed graph: this
 * renders inside a small chat-sidebar-width widget, where a well-labeled
 * list of "who's connected and how" is more legible than a graph
 * visualization, and it reuses `SearchResultsList`'s proven row/pagination
 * pattern instead of introducing a new rendering approach (or a graph
 * layout dependency) for a single widget.
 *
 * A pure, presentational component — like `SearchResultsList`, it takes its
 * data and pagination callback as props rather than fetching anything
 * itself. The widget build's mount entry
 * (`src/widget-entries/connections-graph.entry.tsx`) wires it to
 * `useConnectionsData`; a future non-widget consumer (`app/`) would wire it
 * to its own data fetching and pagination instead.
 *
 * Uses CSS container queries (`@container`/`@sm:`), not viewport media
 * queries, so it reflows correctly whether it's rendered in a narrow chat
 * sidebar or at full width — same responsiveness convention as `EntityCard`
 * and `SearchResultsList`.
 */
export function ConnectionsGraph({
  data,
  onLoadMore,
  isLoadingMore,
}: ConnectionsGraphProps) {
  return (
    <div className="@container">
      <div className="bg-ew-surface border-ew-border flex flex-col gap-3 rounded-2xl border p-4">
        <p className="text-ew-ink-soft text-xs font-medium">
          Showing {data.items.length} of {data.total}
        </p>

        {data.items.length > 0 ? (
          <ul className="flex flex-col">
            {data.items.map((item) => (
              <ConnectionRowItem key={item.entity.id} item={item} />
            ))}
          </ul>
        ) : (
          <p className="text-ew-ink text-sm">No connections found.</p>
        )}

        {data.next_cursor !== null ? (
          <button
            type="button"
            onClick={() => {
              void onLoadMore();
            }}
            disabled={isLoadingMore}
            className="bg-ew-muted text-ew-muted-ink self-start rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-60"
          >
            {isLoadingMore ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
