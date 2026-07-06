import { useCallback, useRef, useState } from "react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  ConnectionItem,
  ConnectionRelationship,
  ConnectionsData,
  EntityCardData,
  EntityType,
  SearchResultRow,
  SearchResultsData,
  TrustLevel,
} from "../types";

const ENTITY_TYPES: readonly EntityType[] = [
  "person",
  "organization",
  "initiative",
  "campaign",
  "event",
];

const TRUST_LEVELS: readonly TrustLevel[] = [
  "subject_verified",
  "atlas_verified",
  "corroborated",
  "unverified",
];

function isEntityType(value: unknown): value is EntityType {
  return (
    typeof value === "string" &&
    (ENTITY_TYPES as readonly string[]).includes(value)
  );
}

function isTrustLevel(value: unknown): value is TrustLevel {
  return (
    typeof value === "string" &&
    (TRUST_LEVELS as readonly string[]).includes(value)
  );
}

/** Returns `value[key]` as a plain record when it's a non-null object, else `null`. */
function readNestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key];
  return typeof nested === "object" && nested !== null
    ? (nested as Record<string, unknown>)
    : null;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const raw = value[key];
  return typeof raw === "string" ? raw : null;
}

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
 * Reads `record.profile_url` and returns it only when it's an `https://` URL.
 * `EntityCardData.profile_url` is rendered as a real `<a href>` — accepting
 * any string here would let a future, less-trusted tool result (or a bug in
 * Atlas's own server) inject a `javascript:` URI that executes on click.
 */
function readHttpsProfileUrl(record: Record<string, unknown>): string | null {
  const raw = readOptionalString(record, "profile_url");
  return raw?.startsWith("https://") ? raw : null;
}

/**
 * Defensively narrow an MCP tool's `structuredContent` payload — shaped like
 * Atlas's full `EntityResponse` (see `api/atlas/domains/catalog/schemas/public.py`)
 * — down to the `SearchResultRow` fields shared by every rendering of an
 * entity: identity, type, formatted location, trust tier, and source count.
 *
 * `parseEntityCardData` builds `EntityCardData` on top of this same parsing
 * step (rather than re-checking these fields itself) so the full card and
 * the compact list row can never drift apart on the fields they share.
 *
 * Atlas's own MCP server is the only source for this payload in Phase 1, so
 * this performs reasonable shape checks rather than full schema validation.
 * Returns `null` when the payload doesn't look like a usable entity record.
 */
function parseSearchResultRow(value: unknown): SearchResultRow | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;

  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    !isEntityType(record.type)
  ) {
    return null;
  }
  if (typeof record.source_count !== "number") {
    return null;
  }

  const address = readNestedRecord(record, "address");
  const place_label = address ? readOptionalString(address, "display") : null;

  const trust = readNestedRecord(record, "trust");
  const trustLevelValue = trust ? trust.level : undefined;
  const trust_level: TrustLevel = isTrustLevel(trustLevelValue)
    ? trustLevelValue
    : "unverified";

  return {
    id: record.id,
    name: record.name,
    type: record.type,
    place_label,
    trust_level,
    source_count: record.source_count,
  };
}

/**
 * Defensively narrow an MCP tool's `structuredContent` payload — shaped like
 * Atlas's full `EntityResponse` — down to the flat `EntityCardData` this
 * widget renders. Returns `null` when the payload doesn't look like a usable
 * entity record.
 */
export function parseEntityCardData(
  structuredContent: unknown,
): EntityCardData | null {
  const row = parseSearchResultRow(structuredContent);
  if (!row) {
    return null;
  }
  const record = structuredContent as Record<string, unknown>;

  return {
    ...row,
    description: readOptionalString(record, "description"),
    photo_url: readOptionalString(record, "photo_url"),
    profile_url: readHttpsProfileUrl(record),
  };
}

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
 * same `parseSearchResultRow` `SearchResultsList` uses, rather than
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

export interface EntityCardConnectionState {
  /** Parsed tool result, or `null` until the first one arrives. */
  data: EntityCardData | null;
  /**
   * Set when the host connection itself failed (handshake/transport error,
   * surfaced by `useApp`) — distinct from a malformed tool payload, which is
   * logged as a console warning and otherwise leaves `data` as `null`.
   */
  error: Error | null;
}

/**
 * React hook that connects to the MCP Apps host, listens for the entity
 * tool's result, and keeps the document theme/styles/fonts in sync with the
 * host as they change.
 *
 * Built on top of `@modelcontextprotocol/ext-apps/react`'s own `useApp` (for
 * the connect lifecycle — including surfacing connect failures via `error`,
 * rather than this package re-deriving that from a bare `.then()`) and
 * `useHostStyles` (for applying the host's theme/CSS variables/fonts). This
 * package's own code is limited to narrowing a tool result into
 * `EntityCardData` (`parseEntityCardData`) plus registering `app.onerror` —
 * `useApp`'s `error` only reflects the initial connect handshake, so a
 * runtime protocol error after a successful connection would otherwise be
 * silently dropped.
 *
 * Returns `{ data: null, error: null }` until the first tool result arrives
 * or the connection fails, so callers can render a loading state in the
 * meantime.
 *
 * This hook is only used by the widget build's mount entry point
 * (`src/widget-entries/entity-card.entry.tsx`) — `app/`'s consumption of
 * this package fetches its own data and passes `EntityCardData`-shaped props
 * to `<EntityCard>` directly; it never calls this hook.
 */
export function useEntityCardData(): EntityCardConnectionState {
  const [data, setData] = useState<EntityCardData | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "atlas-entity-card", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = (result: CallToolResult) => {
        const parsed = parseEntityCardData(result.structuredContent);
        if (parsed) {
          setData(parsed);
        } else {
          console.warn(
            "entity-card widget: received a tool result that didn't parse into EntityCardData",
            result.structuredContent,
          );
        }
      };
      // `useApp`'s own `error` return value only reflects the initial connect
      // handshake — it never updates for protocol-level errors that happen
      // after a successful connection. Without this, such errors (the
      // Protocol base class's `onerror`, invoked for the life of the
      // connection) would be silently dropped.
      app.onerror = (error: Error) => {
        console.error(error);
      };
    },
  });

  useHostStyles(app, app?.getHostContext());

  return { data, error };
}

const SEARCH_ENTITIES_TOOL_NAME = "search_entities";

export interface SearchResultsConnectionState {
  /** Parsed tool result, or `null` until the first one arrives. */
  data: SearchResultsData | null;
  /**
   * Set when the host connection itself failed (handshake/transport error,
   * surfaced by `useApp`) — distinct from a malformed tool payload, which is
   * logged as a console warning and otherwise leaves `data` as `null`.
   */
  error: Error | null;
  /**
   * Re-invoke `search_entities` with the original search's filters plus the
   * next page's cursor, appending the new rows to `data.items` rather than
   * replacing them.
   *
   * A no-op while `data` is `null`, `data.next_cursor` is `null` (no further
   * page), or a previous `loadMore` call is still in flight.
   */
  loadMore: () => Promise<void>;
  /** True while a `loadMore` call is in flight. */
  isLoadingMore: boolean;
}

/**
 * React hook that connects to the MCP Apps host, listens for the
 * `search_entities` tool's result, keeps the document theme/styles/fonts in
 * sync with the host, and supports paginating via `app.callServerTool` — the
 * documented SDK method for a widget to re-invoke a tool on the originating
 * MCP server (proxied through the host).
 *
 * Pagination re-sends the *original* call's arguments (whatever
 * place/issue_areas/text/entity_types/source_types/limit the host actually
 * called `search_entities` with) plus the new cursor, rather than guessing
 * at a simplified `{ cursor, limit }` that would silently drop any other
 * filter the original search used. The original arguments are captured from
 * `app.ontoolinput` — a real, documented handler the host calls with the
 * tool's complete arguments before its result arrives (see
 * `McpUiToolInputNotification` in `@modelcontextprotocol/ext-apps`) — since
 * neither the tool result's `structuredContent` nor any other callback
 * exposes the arguments the host actually called the tool with.
 *
 * `loadMore` appends the new page's rows to the existing list rather than
 * replacing it. Like `useEntityCardData`, this hook is only used by the
 * widget build's mount entry point (`src/widget-entries/search-results.entry.tsx`).
 */
export function useSearchResultsData(): SearchResultsConnectionState {
  const [data, setData] = useState<SearchResultsData | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const originalArgumentsRef = useRef<Record<string, unknown>>({});

  const { app, error } = useApp({
    appInfo: { name: "atlas-search-results", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolinput = (params) => {
        originalArgumentsRef.current = params.arguments ?? {};
      };
      app.ontoolresult = (result: CallToolResult) => {
        const parsed = parseSearchResultsData(result.structuredContent);
        if (parsed) {
          setData(parsed);
        } else {
          console.warn(
            "search-results widget: received a tool result that didn't parse into SearchResultsData",
            result.structuredContent,
          );
        }
      };
      // See `useEntityCardData` for why this is registered directly instead
      // of relying on `useApp`'s own `error`, which only reflects the
      // initial connect handshake.
      app.onerror = (error: Error) => {
        console.error(error);
      };
    },
  });

  useHostStyles(app, app?.getHostContext());

  const loadMore = useCallback(async () => {
    if (!app || data?.next_cursor == null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    try {
      const result = await app.callServerTool({
        name: SEARCH_ENTITIES_TOOL_NAME,
        arguments: {
          ...originalArgumentsRef.current,
          cursor: data.next_cursor,
        },
      });
      const parsed = parseSearchResultsData(result.structuredContent);
      if (parsed) {
        // Append to this call's own closed-over `data` rather than reading
        // React's latest state via a functional updater: the guard above
        // already confirmed `data` is non-null before `callServerTool` was
        // ever invoked, so there's no "previous state is absent" case here
        // to defend against within a single `loadMore` call.
        setData({ ...parsed, items: [...data.items, ...parsed.items] });
      } else {
        console.warn(
          "search-results widget: loadMore received a tool result that didn't parse into SearchResultsData",
          result.structuredContent,
        );
      }
    } catch (loadMoreError) {
      // Never surface a raw error to the UI: log it and leave the existing
      // page of results in place so a transient failure doesn't blank the
      // widget. The user can retry via the same "Load more" control.
      console.error(loadMoreError);
    } finally {
      setIsLoadingMore(false);
    }
  }, [app, data, isLoadingMore]);

  return { data, error, loadMore, isLoadingMore };
}

const GET_RELATED_ENTITIES_TOOL_NAME = "get_related_entities";

export interface ConnectionsConnectionState {
  /** Parsed tool result, or `null` until the first one arrives. */
  data: ConnectionsData | null;
  /**
   * Set when the host connection itself failed (handshake/transport error,
   * surfaced by `useApp`) — distinct from a malformed tool payload, which is
   * logged as a console warning and otherwise leaves `data` as `null`.
   */
  error: Error | null;
  /**
   * Re-invoke `get_related_entities` with the original call's arguments
   * (`entity_id`, `relation_types`, `limit`) plus the next page's cursor,
   * appending the new rows to `data.items` rather than replacing them.
   *
   * A no-op while `data` is `null`, `data.next_cursor` is `null` (no further
   * page), or a previous `loadMore` call is still in flight.
   */
  loadMore: () => Promise<void>;
  /** True while a `loadMore` call is in flight. */
  isLoadingMore: boolean;
}

/**
 * React hook that connects to the MCP Apps host, listens for the
 * `get_related_entities` tool's result, keeps the document theme/styles/fonts
 * in sync with the host, and supports paginating via `app.callServerTool` —
 * mirrors `useSearchResultsData`'s pagination mechanics exactly, adapted for
 * `get_related_entities`'s tool name and `ConnectionsData` response shape.
 *
 * Pagination re-sends the *original* call's arguments (`entity_id` plus
 * whatever `relation_types`/`limit` the host actually called
 * `get_related_entities` with) plus the new cursor, rather than guessing at
 * a simplified `{ cursor, limit }` that would silently drop
 * `relation_types` or call the tool for the wrong entity. The original
 * arguments are captured from `app.ontoolinput`, same as
 * `useSearchResultsData`.
 *
 * `loadMore` appends the new page's rows to the existing list rather than
 * replacing it. Like the other two hooks, this is only used by the widget
 * build's mount entry point
 * (`src/widget-entries/connections-graph.entry.tsx`).
 */
export function useConnectionsData(): ConnectionsConnectionState {
  const [data, setData] = useState<ConnectionsData | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const originalArgumentsRef = useRef<Record<string, unknown>>({});

  const { app, error } = useApp({
    appInfo: { name: "atlas-connections", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolinput = (params) => {
        originalArgumentsRef.current = params.arguments ?? {};
      };
      app.ontoolresult = (result: CallToolResult) => {
        const parsed = parseConnectionsData(result.structuredContent);
        if (parsed) {
          setData(parsed);
        } else {
          console.warn(
            "connections widget: received a tool result that didn't parse into ConnectionsData",
            result.structuredContent,
          );
        }
      };
      // See `useEntityCardData` for why this is registered directly instead
      // of relying on `useApp`'s own `error`, which only reflects the
      // initial connect handshake.
      app.onerror = (error: Error) => {
        console.error(error);
      };
    },
  });

  useHostStyles(app, app?.getHostContext());

  const loadMore = useCallback(async () => {
    if (!app || data?.next_cursor == null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    try {
      const result = await app.callServerTool({
        name: GET_RELATED_ENTITIES_TOOL_NAME,
        arguments: {
          ...originalArgumentsRef.current,
          cursor: data.next_cursor,
        },
      });
      const parsed = parseConnectionsData(result.structuredContent);
      if (parsed) {
        // Append to this call's own closed-over `data` rather than reading
        // React's latest state via a functional updater: the guard above
        // already confirmed `data` is non-null before `callServerTool` was
        // ever invoked, so there's no "previous state is absent" case here
        // to defend against within a single `loadMore` call.
        setData({ ...parsed, items: [...data.items, ...parsed.items] });
      } else {
        console.warn(
          "connections widget: loadMore received a tool result that didn't parse into ConnectionsData",
          result.structuredContent,
        );
      }
    } catch (loadMoreError) {
      // Never surface a raw error to the UI: log it and leave the existing
      // page of results in place so a transient failure doesn't blank the
      // widget. The user can retry via the same "Load more" control.
      console.error(loadMoreError);
    } finally {
      setIsLoadingMore(false);
    }
  }, [app, data, isLoadingMore]);

  return { data, error, loadMore, isLoadingMore };
}
