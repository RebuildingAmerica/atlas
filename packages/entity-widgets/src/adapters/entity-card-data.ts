import type { EntityCardData } from "../types";
import { parseSearchResultRow, readOptionalString } from "./parse-entity-row";
import {
  useWidgetToolConnection,
  type WidgetConnectionState,
} from "./use-widget-connection";

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

export type EntityCardConnectionState = WidgetConnectionState<EntityCardData>;

/**
 * React hook that connects to the MCP Apps host, listens for the entity
 * tool's result, and keeps the document theme/styles/fonts in sync with the
 * host as they change.
 *
 * A thin specialization of `useWidgetToolConnection` (see
 * `use-widget-connection.ts`, which holds the `useApp`/`ontoolresult`/
 * `onerror`/`useHostStyles` plumbing this hook and the other two widgets'
 * hooks all need identically) — this hook supplies only what's unique to
 * the entity card: its `appInfo` and `parseEntityCardData`.
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
  const { data, error } = useWidgetToolConnection({
    appInfo: { name: "atlas-entity-card", version: "1.0.0" },
    parse: parseEntityCardData,
    widgetLabel: "entity-card widget",
    typeName: "EntityCardData",
  });
  return { data, error };
}
