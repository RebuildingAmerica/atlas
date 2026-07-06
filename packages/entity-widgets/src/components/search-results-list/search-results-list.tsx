import type { SearchResultRow, SearchResultsData } from "../../types";
import { formatEntityTypeAndPlace } from "../../lib/entity-type-labels";
import { TrustBadgeRow } from "../trust-badge-row/trust-badge-row";
import { PaginatedListShell } from "../paginated-list-shell/paginated-list-shell";

export interface SearchResultsListProps {
  data: SearchResultsData;
  /**
   * Fetch and append the next page. Returns a `Promise` (mirrors
   * `useSearchResultsData`'s `loadMore`) — passed straight through to
   * `PaginatedListShell`, which handles not letting a rejection surface as
   * an unhandled rejection from a native DOM event handler.
   */
  onLoadMore: () => Promise<void>;
  isLoadingMore: boolean;
}

export interface SearchResultRowContentProps {
  row: SearchResultRow;
}

/**
 * One result's content: name, a "Type · City, State" one-liner, and a trust
 * indicator. Renders only the row's inner content — `PaginatedListShell`
 * owns the surrounding `<li>`/border/padding.
 */
function SearchResultRowContent({ row }: SearchResultRowContentProps) {
  return (
    <div className="flex flex-col gap-1 @sm:flex-row @sm:items-center @sm:justify-between @sm:gap-3">
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
    </div>
  );
}

/**
 * Compact, scannable list of entity rows for the `search_entities` MCP Apps
 * widget: one row per result (name, type/location, and a trust indicator
 * reused from `TrustBadgeRow` rather than reinventing badge rendering), a
 * "Showing N of TOTAL" count, and a "Load more" button when there's a
 * further page — all via the shared `PaginatedListShell`, which also backs
 * `ConnectionsGraph`.
 *
 * A pure, presentational component — like `EntityCard`, it takes its data
 * and pagination callback as props rather than fetching anything itself.
 * The widget build's mount entry (`src/widget-entries/search-results.entry.tsx`)
 * wires it to `useSearchResultsData`; a future non-widget consumer (`app/`)
 * would wire it to its own data fetching and pagination instead.
 */
export function SearchResultsList({
  data,
  onLoadMore,
  isLoadingMore,
}: SearchResultsListProps) {
  return (
    <PaginatedListShell
      items={data.items}
      total={data.total}
      nextCursor={data.next_cursor}
      onLoadMore={onLoadMore}
      isLoadingMore={isLoadingMore}
      emptyMessage="No matching entities found."
      itemKey={(row) => row.id}
    >
      {(row) => <SearchResultRowContent row={row} />}
    </PaginatedListShell>
  );
}
