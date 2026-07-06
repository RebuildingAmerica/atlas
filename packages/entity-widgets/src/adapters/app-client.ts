import { useEffect, useState } from "react";
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
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
    profile_url: readOptionalString(record, "profile_url"),
  };
}

/**
 * Apply the host's visual context (theme, CSS variables, fonts) to the
 * current document. Exported separately from `useEntityCardData` so it's
 * independently testable.
 */
export function applyHostContext(context: McpUiHostContext): void {
  if (context.theme) {
    applyDocumentTheme(context.theme);
  }
  if (context.styles?.variables) {
    applyHostStyleVariables(context.styles.variables);
  }
  if (context.styles?.css?.fonts) {
    applyHostFonts(context.styles.css.fonts);
  }
}

/**
 * React hook that connects to the MCP Apps host, listens for the entity
 * tool's result, and keeps the document theme/styles/fonts in sync with the
 * host as they change.
 *
 * Returns `null` until the first tool result arrives, so callers can render
 * a loading state in the meantime.
 *
 * This hook (and the `App` instance it creates) is only used by the widget
 * build's mount entry point (`src/widget-entries/entity-card.entry.tsx`) —
 * `app/`'s consumption of this package fetches its own data and passes
 * `EntityCardData`-shaped props to `<EntityCard>` directly; it never calls
 * this hook.
 */
export function useEntityCardData(): EntityCardData | null {
  const [data, setData] = useState<EntityCardData | null>(null);

  useEffect(() => {
    const app = new App({ name: "atlas-entity-card", version: "1.0.0" });

    app.ontoolresult = (result: CallToolResult) => {
      const parsed = parseEntityCardData(result.structuredContent);
      if (parsed) {
        setData(parsed);
      }
    };

    app.onhostcontextchanged = (context: McpUiHostContext) => {
      applyHostContext(context);
    };

    app.onerror = (error: Error) => {
      console.error(error);
    };

    void app.connect().then(() => {
      const context = app.getHostContext();
      if (context) {
        applyHostContext(context);
      }
    });
  }, []);

  return data;
}
