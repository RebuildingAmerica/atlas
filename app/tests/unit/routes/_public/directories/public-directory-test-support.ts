import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";
import type {
  PublicDirectoryFederation,
  PublicDirectoryResponse,
  PublicDirectoryWorkspace,
} from "@/domains/catalog/server/public-directory";
import type {
  ClaimEvidenceConfidence,
  ClaimEvidenceInfo,
  ClaimEvidenceSet,
  Entry,
} from "@rebuildingamerica/atlas-api-client";

export interface PublicDirectoryFixtureInput {
  entries?: Entry[];
  federation?: PublicDirectoryFederation;
  lastReviewedAt?: string | null;
  privateNotesExposed?: boolean;
  recordCount?: number;
  sponsorLabel?: string | null;
  workspace?: PublicDirectoryWorkspace;
}

/**
 * Builds the directory payload the public directory route renders.
 *
 * The page has a lot of conditional trim -- sponsor line, verified domain,
 * review date, federation panel -- so tests vary one facet at a time against
 * this baseline rather than restating the whole document.
 *
 * @param input - The facets a given test cares about.
 * @returns A complete public directory response.
 */
export function publicDirectoryFixture(
  input: PublicDirectoryFixtureInput = {},
): PublicDirectoryResponse {
  const entries = input.entries ?? [];
  return {
    title: "Kansas City tenant power directory",
    sponsor_label: input.sponsorLabel ?? null,
    workspace: input.workspace ?? { id: "tenant-kc", name: "Tenant KC" },
    scope: {
      issue_area_ids: ["housing_affordability"],
      geography_labels: ["Kansas City, MO"],
      entry_types: ["organization"],
    },
    stats: {
      record_count: input.recordCount ?? entries.length,
      source_count: 3,
      source_backed_record_count: 2,
      last_reviewed_at: input.lastReviewedAt === undefined ? "2026-07-03" : input.lastReviewedAt,
    },
    publication: {
      visibility: "public",
      private_notes_exposed: input.privateNotesExposed ?? false,
    },
    methodology: {
      summary: "Records qualify after workspace review and linked source evidence.",
      source_policy: "Every public record includes at least one linked source packet.",
      review_policy: "Unsourced workspace records are held for review before publication.",
      correction_policy:
        "Each listed record accepts stale, incorrect, or missing-context feedback.",
      correction_path_template: "/feedback/{slug}?kind=incorrect",
      missing_context_path_template: "/feedback/{slug}?kind=missing_context",
    },
    entries,
    trust_footer: {
      label: "Powered by Atlas",
      provenance_required: true,
      body: "Every listed profile keeps source packets and claim-level evidence.",
    },
    ...(input.federation ? { federation: input.federation } : {}),
  };
}

export interface DirectoryEntryFixtureInput {
  confidence?: ClaimEvidenceConfidence;
  id: string;
  name: string;
  slug: string;
  sourceCount?: number;
  type: Entry["type"];
}

/**
 * Builds a claim-evidence block whose summary carries one confidence level.
 *
 * @param confidence - Confidence the directory badge should show.
 * @returns A complete evidence set.
 */
function claimEvidenceAt(confidence: ClaimEvidenceConfidence): ClaimEvidenceSet {
  const info: ClaimEvidenceInfo = {
    confidence,
    source_count: 2,
    source_ids: ["source-1", "source-2"],
    verification_level: "source-derived",
  };
  return { contact: info, issues: info, place: info, summary: info };
}

/**
 * Builds one listed profile for the directory fixture.
 *
 * @param input - Identity of the listed record, and whether it carries claim
 *   evidence.
 * @returns An entry the directory page can render.
 */
export function directoryEntryFixture(input: DirectoryEntryFixtureInput): Entry {
  const entry = createEntryFixture({
    id: input.id,
    name: input.name,
    slug: input.slug,
    type: input.type,
    city: "Kansas City",
    state: "MO",
    description: `${input.name} description.`,
    source_count: input.sourceCount ?? 2,
  });

  if (input.confidence === undefined) {
    return entry;
  }

  return { ...entry, claim_evidence: claimEvidenceAt(input.confidence) };
}
