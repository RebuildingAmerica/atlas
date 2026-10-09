import type { MergeCounts, MergePreview, ProfileMerge } from "@/domains/editorial/merges.functions";

/** Counts with nothing moving. */
export function noMoves(): MergeCounts {
  return {
    connections: 0,
    followers: 0,
    identityKeys: 0,
    issueAreas: 0,
    openReports: 0,
    pendingReviews: 0,
    savedListPlaces: 0,
    sources: 0,
  };
}

/** A merge the editor may make: the duplicate brings sources and a follower. */
export function mergePreview(overrides: Partial<MergePreview> = {}): MergePreview {
  return {
    blockers: [],
    duplicate: {
      active: true,
      id: "entry-dup",
      name: "Reno Tenants",
      slug: "reno-tenants",
      type: "organization",
    },
    keep: {
      active: true,
      id: "entry-keep",
      name: "Reno Tenants Union",
      slug: "reno-tenants-union",
      type: "organization",
    },
    moves: { ...noMoves(), followers: 1, pendingReviews: 2, sources: 3 },
    ...overrides,
  };
}

/** A merge already made, as the API returns it. */
export function apiProfileMerge() {
  return {
    duplicate_name: "Reno Tenants",
    duplicate_slug: "reno-tenants",
    id: "merge-1",
    kept_name: "Reno Tenants Union",
    kept_slug: "reno-tenants-union",
    merged_at: "2026-10-09T15:00:00Z",
    merged_by: "editor@rebuildingus.org",
    moved: {
      connections: 0,
      followers: 1,
      identity_keys: 1,
      issue_areas: 0,
      open_reports: 0,
      pending_reviews: 0,
      saved_list_places: 0,
      sources: 3,
    },
    reason: "Same EIN on both filings.",
  };
}

/** The same merge as the merge page sees it. */
export function profileMerge(): ProfileMerge {
  return {
    duplicateName: "Reno Tenants",
    duplicateSlug: "reno-tenants",
    id: "merge-1",
    keptName: "Reno Tenants Union",
    keptSlug: "reno-tenants-union",
    mergedAt: "2026-10-09T15:00:00Z",
    mergedBy: "editor@rebuildingus.org",
    moved: { ...noMoves(), followers: 1, identityKeys: 1, sources: 3 },
    reason: "Same EIN on both filings.",
  };
}
