import type {
  SearchResultRow,
  SearchResultsData,
} from "@rebuildingamerica/entity-widgets";
import { parseSearchResultRow } from "./parse-entity-row";
import {
  usePaginatedWidgetData,
  type PaginatedWidgetConnectionState,
} from "./use-widget-connection";

/**
 * Defensively narrow an MCP tool's `structuredContent` payload — shaped like
 * Atlas's `EntityCollectionResponse` (see
 * `api/atlas/domains/catalog/schemas/public.py`) — down to the flat
 * `SearchResultsData` this widget renders.
 *
 * A malformed *individual* row is dropped (with a console warning) rather
 * than failing the whole page: a page of otherwise-good results is more
 * useful than an empty list because one entry didn't parse. The top-level
 * shape (`items` an array, `total` a number) still has to be correct, or the
 * whole payload is rejected the same way `parseEntityCardData` rejects an
 * unusable single record.
 */
export function parseSearchResultsData(
  structuredContent: unknown,
): SearchResultsData | null {
  if (typeof structuredContent !== "object" || structuredContent === null) {
    return null;
  }
  const record = structuredContent as Record<string, unknown>;

  if (!Array.isArray(record.items) || typeof record.total !== "number") {
    return null;
  }

  const items: SearchResultRow[] = [];
  for (const rawItem of record.items) {
    const parsed = parseSearchResultRow(rawItem);
    if (parsed) {
      items.push(parsed);
    } else {
      console.warn(
        "search-results widget: dropped a list item that didn't parse into SearchResultRow",
        rawItem,
      );
    }
  }

  const next_cursor =
    typeof record.next_cursor === "string" ? record.next_cursor : null;

  return { items, total: record.total, next_cursor };
}

const SEARCH_ENTITIES_TOOL_NAME = "search_entities";

/**
 * Module-level (not inline-arrow) so it's a stable reference across
 * renders — passed straight through to `usePaginatedWidgetData`'s internal
 * `useCallback` dependency array, keeping `loadMore`'s identity stable
 * whenever `app`/`data`/`isLoadingMore` haven't changed, same as before this
 * logic was factored out of this hook.
 */
function appendSearchResultsPage(
  previous: SearchResultsData,
  page: SearchResultsData,
): SearchResultsData {
  return { ...page, items: [...previous.items, ...page.items] };
}

function getSearchResultsNextCursor(data: SearchResultsData): string | null {
  return data.next_cursor;
}

export type SearchResultsConnectionState =
  PaginatedWidgetConnectionState<SearchResultsData>;

/**
 * React hook that connects to the MCP Apps host, listens for the
 * `search_entities` tool's result, keeps the document theme/styles/fonts in
 * sync with the host, and supports paginating via `app.callServerTool` — the
 * documented SDK method for a widget to re-invoke a tool on the originating
 * MCP server (proxied through the host).
 *
 * A thin specialization of `usePaginatedWidgetData` (see
 * `use-widget-connection.ts` for the pagination mechanics — the guard
 * clause, `callServerTool` call, and parse-or-warn/catch-and-log handling —
 * shared with `useConnectionsData`). Pagination re-sends the *original*
 * call's arguments (whatever place/issue_areas/text/entity_types/
 * source_types/limit the host actually called `search_entities` with) plus
 * the new cursor, rather than guessing at a simplified `{ cursor, limit }`
 * that would silently drop any other filter the original search used — the
 * original arguments are captured from `app.ontoolinput` inside the shared
 * hook.
 *
 * Like `useEntityCardData`, this hook is only used by the widget build's
 * mount entry point (`src/widget-entries/search-results.entry.tsx`).
 */
export function useSearchResultsData(): SearchResultsConnectionState {
  return usePaginatedWidgetData({
    appInfo: { name: "atlas-search-results", version: "1.0.0" },
    parse: parseSearchResultsData,
    widgetLabel: "search-results widget",
    typeName: "SearchResultsData",
    toolName: SEARCH_ENTITIES_TOOL_NAME,
    appendPage: appendSearchResultsPage,
    getNextCursor: getSearchResultsNextCursor,
  });
}
