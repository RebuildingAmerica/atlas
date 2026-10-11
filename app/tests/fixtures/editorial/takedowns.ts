import type { ProfileTakedown } from "@/domains/editorial/takedowns.functions";

/** A takedown as the Atlas API returns it. */
export const API_TAKEDOWN = {
  entry_id: "entry-1",
  entry_name: "Dana Example",
  entry_slug: "dana-example",
  entry_type: "person",
  id: "takedown-1",
  reason: "Asked to be removed by email.",
  restored_at: null,
  restored_by: null,
  taken_down_at: "2026-10-08T15:00:00Z",
  taken_down_by: "editor@rebuildingus.org",
  was_active: true,
};

/** A published person taken down at their request. */
export const DANA_TAKEDOWN: ProfileTakedown = {
  entryName: "Dana Example",
  entrySlug: "dana-example",
  entryType: "person",
  id: "takedown-1",
  reason: "Asked to be removed by email.",
  takenDownAt: "2026-10-08T15:00:00Z",
  takenDownBy: "editor@rebuildingus.org",
  wasPublished: true,
};

/** An organization that was still waiting for review when it came down. */
export const HELD_TAKEDOWN: ProfileTakedown = {
  entryName: "Held Group",
  entrySlug: null,
  entryType: "organization",
  id: "takedown-2",
  reason: "Duplicate of a group that dissolved.",
  takenDownAt: "2026-10-07T15:00:00Z",
  takenDownBy: "editor@rebuildingus.org",
  wasPublished: false,
};
