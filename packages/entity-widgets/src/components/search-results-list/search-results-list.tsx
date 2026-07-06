import type { SearchResultRow, SearchResultsData } from "../../types";
import { formatEntityTypeAndPlace } from "../../lib/entity-type-labels";
import { TrustBadgeRow } from "../trust-badge-row/trust-badge-row";

export interface SearchResultsListProps {
  data: SearchResultsData;
  /**
   * Fetch and append the next page. Returns a `Promise` (mirrors
   * `useSearchResultsData`'s `loadMore`) — the button's `onClick` wraps the
   * call in `void` rather than passing it directly, so a rejected promise
   * can never surface as an unhandled rejection from a native DOM event
   * handler.
   */
  onLoadMore: () => Promise<void>;
  isLoadingMore: boolean;
}

export interface SearchResultRowItemProps {
  row: SearchResultRow;
}

/** One row: name, a "Type · City, State" one-liner, and a trust indicator. */
function SearchResultRowItem({ row }: SearchResultRowItemProps) {
  return (
    <li className="border-ew-border flex flex-col gap-1 border-b py-3 last:border-b-0 @sm:flex-row @sm:items-center @sm:justify-between @sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-ew-ink truncate text-sm font-semibold">
          {row.name}
        </p>
        <p className="text-ew-ink-soft text-xs">
          {formatEntityTypeAndPlace(row)}
        </p>
      </div>
      <TrustBadgeRow
        verificationLevel={row.trust_level}
        sourceCount={row.source_count}
      />
    </li>
  );
}

/**
 * Compact, scannable list of entity rows for the `search_entities` MCP Apps
 * widget: one row per result (name, type/location, and a trust indicator
 * reused from `TrustBadgeRow` rather than reinventing badge rendering), a
 * "Showing N of TOTAL" count, and a "Load more" button when there's a
 * further page (`data.next_cursor !== null`).
 *
 * A pure, presentational component — like `EntityCard`, it takes its data
 * and pagination callback as props rather than fetching anything itself.
 * The widget build's mount entry (`src/widget-entries/search-results.entry.tsx`)
 * wires it to `useSearchResultsData`; a future non-widget consumer (`app/`)
 * would wire it to its own data fetching and pagination instead.
 *
 * Uses CSS container queries (`@container`/`@sm:`), not viewport media
 * queries, so it reflows correctly whether it's rendered in a narrow chat
 * sidebar or at full width — same responsiveness convention as `EntityCard`.
 */
export function SearchResultsList({
  data,
  onLoadMore,
  isLoadingMore,
}: SearchResultsListProps) {
  return (
    <div className="@container">
      <div className="bg-ew-surface border-ew-border flex flex-col gap-3 rounded-2xl border p-4">
        <p className="text-ew-ink-soft text-xs font-medium">
          Showing {data.items.length} of {data.total}
        </p>

        {data.items.length > 0 ? (
          <ul className="flex flex-col">
            {data.items.map((row) => (
              <SearchResultRowItem key={row.id} row={row} />
            ))}
          </ul>
        ) : (
          <p className="text-ew-ink text-sm">No matching entities found.</p>
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
