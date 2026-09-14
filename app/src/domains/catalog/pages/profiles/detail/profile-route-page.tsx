import { DeferredEntry } from "./deferred-entry";
import { NonActorProfilePage } from "./non-actor-profile-page";
import { OrgProfilePage } from "./org-profile-page";
import { PersonProfilePage } from "./person-profile-page";
import { ProfilePageSkeleton } from "./profile-page-skeleton";
import type { Entry, EntrySlugScope } from "@rebuildingamerica/atlas-api-client";

interface ProfileRoutePageProps {
  scope: EntrySlugScope;
  slug: string;
  /** The loader's entry, or `undefined` when the loader's API call failed. */
  entry: Entry | undefined;
}

function renderProfile(scope: EntrySlugScope, entry: Entry) {
  if (scope === "people") {
    return <PersonProfilePage entry={entry} />;
  }
  if (scope === "organizations") {
    return <OrgProfilePage entry={entry} />;
  }
  return <NonActorProfilePage entry={entry} />;
}

/**
 * The page every profile detail route renders.
 *
 * A loader that reached the API hands its entry straight to the profile. A
 * loader whose call failed hands over nothing, and the page then shows the
 * profile's frame while the browser fetches the entry itself, so an outage
 * delays the profile instead of replacing it with an error.
 */
export function ProfileRoutePage({ scope, slug, entry }: ProfileRoutePageProps) {
  if (entry) {
    return renderProfile(scope, entry);
  }

  const layout = scope === "people" || scope === "organizations" ? "actor" : "record";

  return (
    <DeferredEntry lookup={{ scope, slug }} placeholder={<ProfilePageSkeleton layout={layout} />}>
      {(fetched) => renderProfile(scope, fetched)}
    </DeferredEntry>
  );
}
