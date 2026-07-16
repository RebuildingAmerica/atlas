import { Link } from "@tanstack/react-router";
import type { BrowseRouteSearch } from "@rebuildingamerica/atlas-catalog/search-state";

interface ScopeTab {
  isActive?: boolean;
  label: string;
  search?: BrowseRouteSearch;
  to: "/profiles" | "/profiles/people" | "/profiles/organizations";
}

interface BrowseHeroProps {
  description: string;
  eyebrow: string;
  scopeTabs?: ScopeTab[];
  title: string;
}

/**
 * Top hero band on the browse surface.  Renders the eyebrow / title /
 * description copy plus the optional scope-tab pills used by the
 * profile-typed routes (`/profiles`, `/profiles/people`,
 * `/profiles/organizations`) to switch between actor scopes.
 */
export function BrowseHero({ description, scopeTabs, title }: BrowseHeroProps) {
  return (
    <section className="px-1 py-4 lg:px-2 lg:py-5">
      <h1 className="type-display-small text-ink-strong">{title}</h1>
      <p className="type-body-large text-ink-soft mt-2 max-w-3xl">{description}</p>
      {scopeTabs && scopeTabs.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {scopeTabs.map((tab) => (
            <Link
              key={tab.label}
              to={tab.to}
              search={tab.search}
              aria-current={tab.isActive ? "page" : undefined}
              className={[
                "type-label-large rounded-full px-4 py-2 transition-colors",
                tab.isActive
                  ? "bg-ink-strong text-surface"
                  : "bg-surface-container text-ink-strong hover:bg-surface-container-high",
              ].join(" ")}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
