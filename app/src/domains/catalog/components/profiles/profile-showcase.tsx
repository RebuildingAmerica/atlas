import { Building2, Sparkles, UserRound } from "lucide-react";
import type { ProfileBrowseScope } from "@/domains/catalog/profile-browse";
import { buildScopeCopy } from "./profile-showcase-primitives";

export { ProfilesMarquee } from "./profiles-marquee";
export { ProfilesShelf } from "./profiles-shelf";
export { ProfilesIssueLandscape, type IssueLandscapeGroup } from "./profiles-issue-landscape";
export { ProfilesFreshList } from "./profiles-fresh-list";

/**
 * Hero band at the very top of the profiles surface.  Switches its
 * heading copy based on the current scope (people, organizations, or
 * the combined view) so the page identity matches the URL.
 */
export function ProfilesShowcaseHeader({ scope }: { scope: ProfileBrowseScope }) {
  const copy = buildScopeCopy(scope);

  return (
    <section className="bg-surface-container-low pt-6 pb-8 lg:pt-8 lg:pb-10">
      <div className="max-w-[56rem] space-y-6">
        <div className="space-y-3">
          <h1 className="type-display-large text-ink-strong leading-[0.95]">{copy.title}</h1>
          <p className="type-body-large text-ink-soft max-w-3xl text-balance">{copy.description}</p>
        </div>
      </div>
    </section>
  );
}

/**
 * Empty-state placeholder rendered in place of the showcase sections
 * when Atlas has no entries to surface for the current scope.  Keeps
 * the layout rhythm so the surrounding chrome doesn't collapse.
 */
export function ProfilesEmptyState({ scope }: { scope: ProfileBrowseScope }) {
  const title =
    scope === "people"
      ? "No people listed yet."
      : scope === "organizations"
        ? "No organizations listed yet."
        : "No profiles listed yet.";

  return (
    <section className="bg-surface-container rounded-[1.25rem] px-6 py-8 lg:px-8 lg:py-10">
      <div className="space-y-6">
        <div className="space-y-3">
          <h2 className="type-display-small text-ink-strong leading-tight">{title}</h2>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.9fr)]">
          <div className="bg-surface-container-lowest h-56 rounded-[1rem]" />
          <div className="bg-surface-container-low h-56 rounded-[1rem]" />
          <div className="bg-surface-container-low h-56 rounded-[1rem]" />
        </div>
      </div>
    </section>
  );
}

export const PROFILE_SHOWCASE_ICONS = {
  organizations: <Building2 className="h-4 w-4" />,
  people: <UserRound className="h-4 w-4" />,
  spotlight: <Sparkles className="h-4 w-4" />,
};
