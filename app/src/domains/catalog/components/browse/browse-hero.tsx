import { Link } from "@tanstack/react-router";
import type { BrowseRouteSearch } from "@/domains/catalog/search-state";

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
export function BrowseHero({ description, eyebrow, scopeTabs, title }: BrowseHeroProps) {
  return (
    <section className="bg-surface-container-lowest rounded-[1.8rem] px-5 py-6 lg:px-7 lg:py-7">
      <p className="type-label-medium text-ink-muted">{eyebrow}</p>
      <h1 className="type-display-small text-ink-strong mt-3">{title}</h1>
      <p className="type-body-large text-ink-soft mt-3 max-w-3xl">{description}</p>
      {scopeTabs && scopeTabs.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {scopeTabs.map((tab) => (
            <Link
              key={tab.label}
              to={tab.to}
              search={tab.search}
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
