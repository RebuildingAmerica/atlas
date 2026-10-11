import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requestAtlasApi } from "@/domains/discovery/server/api-client";

/** A profile an editor took down and has not restored. */
export interface ProfileTakedown {
  entryName: string;
  entrySlug: string | null;
  entryType: string;
  id: string;
  reason: string;
  takenDownAt: string;
  takenDownBy: string;
  wasPublished: boolean;
}

interface ApiTakedown {
  entry_name: string;
  entry_slug: string | null;
  entry_type: string;
  id: string;
  reason: string;
  taken_down_at: string;
  taken_down_by: string;
  was_active: boolean;
}

interface ApiTakedownCollection {
  items: ApiTakedown[];
}

/**
 * Reads the profile an editor means from what they paste: a full profile
 * address, a path, or the bare slug.
 */
export function profileSlugFrom(address: string): string {
  const trimmed = address.trim();
  const path = /^https?:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed;
  const segments = path.split("/").filter(Boolean);
  const slug = segments.at(-1);
  if (!slug) {
    throw new Error("Paste the profile's address or slug.");
  }
  return decodeURIComponent(slug);
}

const createTakedownSchema = z.object({
  address: z.string().trim().min(1),
  reason: z.string().trim().min(3),
});
const restoreTakedownSchema = z.object({ takedownId: z.string().min(1) });

function toTakedown(item: ApiTakedown): ProfileTakedown {
  return {
    entryName: item.entry_name,
    entrySlug: item.entry_slug,
    entryType: item.entry_type,
    id: item.id,
    reason: item.reason,
    takenDownAt: item.taken_down_at,
    takenDownBy: item.taken_down_by,
    wasPublished: item.was_active,
  };
}

export const listTakedowns = createServerFn({ method: "GET" }).handler(async () => {
  const response = await requestAtlasApi<ApiTakedownCollection>("/takedowns");
  return response.items.map(toTakedown);
});

export const createTakedown = createServerFn({ method: "POST" })
  .validator(createTakedownSchema)
  .handler(async ({ data }) => {
    const created = await requestAtlasApi<ApiTakedown>("/takedowns", {
      body: JSON.stringify({ reason: data.reason, slug: profileSlugFrom(data.address) }),
      method: "POST",
    });
    return toTakedown(created);
  });

export const restoreTakedown = createServerFn({ method: "POST" })
  .validator(restoreTakedownSchema)
  .handler(async ({ data }) => {
    const restored = await requestAtlasApi<ApiTakedown>(
      `/takedowns/${encodeURIComponent(data.takedownId)}/restore`,
      { method: "POST" },
    );
    return toTakedown(restored);
  });
