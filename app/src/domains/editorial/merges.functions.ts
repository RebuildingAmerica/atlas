import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";
import { profileSlugFrom } from "./profile-address";

/** One of the two profiles in a merge, found by its slug. */
export interface MergeProfile {
  active: boolean;
  id: string;
  name: string;
  slug: string;
  type: string;
}

/** What moves from the duplicate to the kept profile. */
export interface MergeCounts {
  connections: number;
  followers: number;
  identityKeys: number;
  issueAreas: number;
  openReports: number;
  pendingReviews: number;
  savedListPlaces: number;
  sources: number;
}

/** What a merge would do, and anything stopping it. */
export interface MergePreview {
  blockers: string[];
  duplicate: MergeProfile;
  keep: MergeProfile;
  moves: MergeCounts;
}

/** A merge that was made. */
export interface ProfileMerge {
  duplicateName: string;
  duplicateSlug: string | null;
  id: string;
  keptName: string;
  keptSlug: string | null;
  mergedAt: string;
  mergedBy: string;
  moved: MergeCounts;
  reason: string;
}

interface ApiMergeCounts {
  connections: number;
  followers: number;
  identity_keys: number;
  issue_areas: number;
  open_reports: number;
  pending_reviews: number;
  saved_list_places: number;
  sources: number;
}

interface ApiMergePreview {
  blockers: string[];
  duplicate: MergeProfile;
  keep: MergeProfile;
  moves: ApiMergeCounts;
}

interface ApiProfileMerge {
  duplicate_name: string;
  duplicate_slug: string | null;
  id: string;
  kept_name: string;
  kept_slug: string | null;
  merged_at: string;
  merged_by: string;
  moved: ApiMergeCounts;
  reason: string;
}

interface ApiProfileMergeCollection {
  items: ApiProfileMerge[];
}

const pairSchema = z.object({
  duplicate: z.string().trim().min(1),
  keep: z.string().trim().min(1),
});
const mergeSchema = pairSchema.extend({ reason: z.string().trim().min(3).max(2000) });

function toCounts(counts: ApiMergeCounts): MergeCounts {
  return {
    connections: counts.connections,
    followers: counts.followers,
    identityKeys: counts.identity_keys,
    issueAreas: counts.issue_areas,
    openReports: counts.open_reports,
    pendingReviews: counts.pending_reviews,
    savedListPlaces: counts.saved_list_places,
    sources: counts.sources,
  };
}

function toMerge(merge: ApiProfileMerge): ProfileMerge {
  return {
    duplicateName: merge.duplicate_name,
    duplicateSlug: merge.duplicate_slug,
    id: merge.id,
    keptName: merge.kept_name,
    keptSlug: merge.kept_slug,
    mergedAt: merge.merged_at,
    mergedBy: merge.merged_by,
    moved: toCounts(merge.moved),
    reason: merge.reason,
  };
}

export const listMerges = createServerFn({ method: "GET" }).handler(async () => {
  const response = await requestAtlasApi<ApiProfileMergeCollection>("/merges");
  return response.items.map(toMerge);
});

export const previewMerge = createServerFn({ method: "POST" })
  .validator(pairSchema)
  .handler(async ({ data }) => {
    const query = new URLSearchParams({
      duplicate: profileSlugFrom(data.duplicate),
      keep: profileSlugFrom(data.keep),
    });
    const preview = await requestAtlasApi<ApiMergePreview>(`/merges/preview?${query.toString()}`);
    return { ...preview, moves: toCounts(preview.moves) } satisfies MergePreview;
  });

export const mergeProfiles = createServerFn({ method: "POST" })
  .validator(mergeSchema)
  .handler(async ({ data }) => {
    const merged = await requestAtlasApi<ApiProfileMerge>("/merges", {
      body: JSON.stringify({
        duplicate: profileSlugFrom(data.duplicate),
        keep: profileSlugFrom(data.keep),
        reason: data.reason,
      }),
      method: "POST",
    });
    return toMerge(merged);
  });
