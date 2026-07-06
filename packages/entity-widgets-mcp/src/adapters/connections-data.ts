import type {
  ConnectionItem,
  ConnectionRelationship,
  ConnectionsData,
} from "@rebuildingamerica/entity-widgets";
import { parseSearchResultRow } from "./parse-entity-row";
import {
  usePaginatedWidgetData,
  type PaginatedWidgetConnectionState,
} from "./use-widget-connection";

/**
 * Reads `value[key]` as an array of strings, dropping any non-string
 * element and defaulting to `[]` when the key is absent or not an array.
 * Shared by `parseConnectionRelationship` for `issue_area_ids`/`source_ids`
 * — both default to an empty list server-side (`EntityRelationship` in
 * `api/atlas/domains/catalog/schemas/public.py`), so an absent key is just
 * as valid as an explicit empty array.
 */
function readStringArray(value: Record<string, unknown>, key: string): string[] {
  const raw = value[key];
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Defensively narrow one raw relationship entry — shaped like Atlas's
 * `EntityRelationship` (see `api/atlas/domains/catalog/schemas/public.py`) —
 * down to `ConnectionRelationship`. Returns `null` when `type` isn't a
 * string; `issue_area_ids`/`source_ids` each default to `[]` via
 * `readStringArray` rather than failing the whole relationship, since both
 * fields are absent from every relationship type except the one they
 * describe.
 */
function parseConnectionRelationship(value: unknown): ConnectionRelationship | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") {
    return null;
  }

  return {
    type: record.type,
    issue_area_ids: readStringArray(record, "issue_area_ids"),
    source_ids: readStringArray(record, "source_ids"),
  };
}

/**
 * Defensively narrow one raw related-entity entry — shaped like Atlas's
 * `EntityRelationshipItem` (see `api/atlas/domains/catalog/schemas/public.py`)
 * — down to `ConnectionItem`. The nested `entity` field is parsed with the
 * same `parseSearchResultRow` `SearchResultsList`'s data uses, rather than
 * duplicating entity-shape parsing a third time. A malformed *individual*
 * relationship is dropped (with a console warning) the same way
 * `parseConnectionsData` drops a malformed item — one bad relationship
 * shouldn't hide an otherwise-good related entity.
 */
function parseConnectionItem(value: unknown): ConnectionItem | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;

  const entity = parseSearchResultRow(record.entity);
  if (!entity) {
    return null;
  }

  const rawRelationships = Array.isArray(record.relationships) ? record.relationships : [];
  const relationships: ConnectionRelationship[] = [];
  for (const rawRelationship of rawRelationships) {
    const parsed = parseConnectionRelationship(rawRelationship);
    if (parsed) {
      relationships.push(parsed);
    } else {
      console.warn(
        "connections widget: dropped a relationship that didn't parse into ConnectionRelationship",
        rawRelationship,
      );
    }
  }

  return { entity, relationships };
}

/**
 * Defensively narrow an MCP tool's `structuredContent` payload — shaped like
 * Atlas's `EntityRelationshipsResponse` (see
 * `api/atlas/domains/catalog/schemas/public.py`) — down to the flat
 * `ConnectionsData` this widget renders.
 *
 * A malformed *individual* item is dropped (with a console warning) rather
 * than failing the whole page, the same way `parseSearchResultsData` treats
 * a malformed search result row. The top-level shape (`entity_id` a string,
 * `items` an array, `total` a number) still has to be correct, or the whole
 * payload is rejected.
 */
export function parseConnectionsData(structuredContent: unknown): ConnectionsData | null {
  if (typeof structuredContent !== "object" || structuredContent === null) {
    return null;
  }
  const record = structuredContent as Record<string, unknown>;

  if (
    typeof record.entity_id !== "string" ||
    !Array.isArray(record.items) ||
    typeof record.total !== "number"
  ) {
    return null;
  }

  const items: ConnectionItem[] = [];
  for (const rawItem of record.items) {
    const parsed = parseConnectionItem(rawItem);
    if (parsed) {
      items.push(parsed);
    } else {
      console.warn(
        "connections widget: dropped a list item that didn't parse into ConnectionItem",
        rawItem,
      );
    }
  }

  const next_cursor =
    typeof record.next_cursor === "string" ? record.next_cursor : null;

  return { entity_id: record.entity_id, items, total: record.total, next_cursor };
}

const GET_RELATED_ENTITIES_TOOL_NAME = "get_related_entities";

/**
 * Module-level (not inline-arrow) so it's a stable reference across
 * renders — see `appendSearchResultsPage` in `search-results-data.ts` for
 * why that matters for `usePaginatedWidgetData`'s internal `useCallback`.
 */
function appendConnectionsPage(
  previous: ConnectionsData,
  page: ConnectionsData,
): ConnectionsData {
  return { ...page, items: [...previous.items, ...page.items] };
}

function getConnectionsNextCursor(data: ConnectionsData): string | null {
  return data.next_cursor;
}

export type ConnectionsConnectionState =
  PaginatedWidgetConnectionState<ConnectionsData>;

/**
 * React hook that connects to the MCP Apps host, listens for the
 * `get_related_entities` tool's result, keeps the document theme/styles/fonts
 * in sync with the host, and supports paginating via `app.callServerTool`.
 *
 * A thin specialization of `usePaginatedWidgetData` (see
 * `use-widget-connection.ts`), mirroring `useSearchResultsData`'s exact
 * pagination mechanics: re-sends the original call's arguments (`entity_id`
 * plus whatever `relation_types`/`limit` the host actually called
 * `get_related_entities` with) plus the new cursor, rather than guessing at
 * a simplified `{ cursor, limit }` that would silently drop
 * `relation_types` or call the tool for the wrong entity.
 *
 * Like the other two hooks, this is only used by the widget build's mount
 * entry point (`src/widget-entries/connections-graph.entry.tsx`).
 */
export function useConnectionsData(): ConnectionsConnectionState {
  return usePaginatedWidgetData({
    appInfo: { name: "atlas-connections", version: "1.0.0" },
    parse: parseConnectionsData,
    widgetLabel: "connections widget",
    typeName: "ConnectionsData",
    toolName: GET_RELATED_ENTITIES_TOOL_NAME,
    appendPage: appendConnectionsPage,
    getNextCursor: getConnectionsNextCursor,
  });
}
