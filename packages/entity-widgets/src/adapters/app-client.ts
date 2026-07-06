import { useState } from "react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { EntityCardData, EntityType, TrustLevel } from "../types";

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
 * — down to the flat `EntityCardData` this widget renders.
 *
 * Atlas's own MCP server is the only source for this payload in Phase 1, so
 * this performs reasonable shape checks rather than full schema validation.
 * Returns `null` when the payload doesn't look like a usable entity record.
 */
export function parseEntityCardData(
  structuredContent: unknown,
): EntityCardData | null {
  if (typeof structuredContent !== "object" || structuredContent === null) {
    return null;
  }
  const record = structuredContent as Record<string, unknown>;

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
    description: readOptionalString(record, "description"),
    photo_url: readOptionalString(record, "photo_url"),
    place_label,
    trust_level,
    source_count: record.source_count,
    profile_url: readHttpsProfileUrl(record),
  };
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
