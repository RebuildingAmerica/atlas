import type { ConnectionRelationship } from "../types";

/**
 * Human labels for Atlas's mechanically-derived relationship types.
 *
 * Kept separate from `entity-type-labels.ts`'s `ENTITY_TYPE_LABELS`: that
 * file labels an entity's own `type` (person/organization/…), a closed,
 * small set. This labels a *relationship between two entities* — a
 * different concept, with its own open-ended, server-defined vocabulary
 * (see `AtlasDataService.get_related_entities` in
 * `api/atlas/platform/mcp/data.py`) — so folding the two together would mix
 * unrelated taxonomies into one lookup table.
 *
 * `shared_issue_area` is deliberately absent here: unlike every other known
 * type, its label depends on its payload (which issue areas are actually
 * shared), so `formatRelationshipLabel` builds that one dynamically instead
 * of using a fixed string from this table.
 */
const KNOWN_RELATIONSHIP_LABELS: Record<string, string> = {
  affiliated_organization: "Same organization",
  affiliated_member: "Affiliated member",
  shared_place: "Same place",
  shared_source: "Shared source",
};

/**
 * Title-cases a raw slug by splitting on `-`/`_` — the same fallback
 * humanization `TrustBadgeRow`'s `humanizeVerificationLevel` applies to an
 * unrecognized verification level, used here both for issue-area ids
 * (`"criminal-justice"` -> `"Criminal Justice"`) and for a relationship
 * `type` this component doesn't recognize by name.
 */
function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Turn one `ConnectionRelationship` into a short, human pill label, e.g.
 * `"Same organization"` or `"Shared issue: Housing, Education"`.
 *
 * `shared_issue_area` is the one type whose label is built from its payload
 * (`issue_area_ids`) rather than looked up as a fixed string — every other
 * known type maps to a fixed entry in `KNOWN_RELATIONSHIP_LABELS`, and an
 * unrecognized type falls back to `humanizeSlug` on the raw `type` string so
 * a relationship type this widget doesn't yet know about still renders
 * something reasonable instead of a raw enum value.
 */
export function formatRelationshipLabel(relationship: ConnectionRelationship): string {
  if (relationship.type === "shared_issue_area") {
    const issueLabels = relationship.issue_area_ids.map(humanizeSlug);
    return issueLabels.length > 0
      ? `Shared issue: ${issueLabels.join(", ")}`
      : "Shared issue area";
  }

  return KNOWN_RELATIONSHIP_LABELS[relationship.type] ?? humanizeSlug(relationship.type);
}
