import type { EntryType } from "@rebuildingamerica/atlas-api-client";

/** A typed link target into a canonical profile page. */
export interface ProfileRoute {
  to: "/profiles/people/$slug" | "/profiles/organizations/$slug";
  params: { slug: string };
}

/**
 * Resolve the canonical profile route for a map actor, or `null` when there
 * isn't one.
 *
 * Atlas renders profile pages only for people and organizations; an initiative,
 * campaign, or event has no canonical page yet, and an actor without a slug has
 * no URL at all. In either case this returns `null` rather than inventing a
 * destination, so the panel can honestly drop the "View full profile" CTA
 * instead of linking somewhere broken.
 *
 * @param type The actor's entity type.
 * @param slug The actor's profile slug, or `null` when it has none.
 * @returns The profile route, or `null` when no profile page exists.
 */
export function profileRouteFor(
  type: EntryType,
  slug: string | null,
): ProfileRoute | null {
  if (slug === null) {
    return null;
  }
  if (type === "organization") {
    return { to: "/profiles/organizations/$slug", params: { slug } };
  }
  if (type === "person") {
    return { to: "/profiles/people/$slug", params: { slug } };
  }
  return null;
}
