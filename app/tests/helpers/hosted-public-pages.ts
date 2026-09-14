import { absoluteHostedUrl, hostedPublicRequestInit } from "./hosted-endpoints";

/** Public pages every visitor can open, each rendered on the server. */
export const PUBLIC_PAGE_PATHS = [
  "/",
  "/browse",
  "/map",
  "/firehose",
  "/profiles/people",
  "/profiles/organizations",
  "/sign-in",
] as const;

interface EntityListItem {
  slug: string;
}

interface EntityListResponse {
  items: EntityListItem[];
}

const PROFILE_COLLECTIONS = { organization: "organizations", person: "people" } as const;

/**
 * Returns the profile page path of the first published entity of a type.
 *
 * @param origin - The hosted public origin.
 * @param entityType - Which kind of profile to open.
 * @returns A path such as `/profiles/people/ana-ortiz-1a2b`.
 */
export async function firstProfilePath(
  origin: string,
  entityType: keyof typeof PROFILE_COLLECTIONS,
): Promise<string> {
  const response = await fetch(
    absoluteHostedUrl(origin, `/api/entities?entry_types=${entityType}&limit=1`),
    hostedPublicRequestInit({ headers: { Accept: "application/json" } }),
  );
  if (!response.ok) {
    throw new Error(`Listing ${entityType} entities returned ${response.status}.`);
  }
  const [first] = ((await response.json()) as EntityListResponse).items;
  if (!first) {
    throw new Error(`The hosted catalog has no published ${entityType}.`);
  }
  return `/profiles/${PROFILE_COLLECTIONS[entityType]}/${first.slug}`;
}
