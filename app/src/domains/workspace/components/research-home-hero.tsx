/**
 * Greeting band for the authenticated "Your Research" home.
 *
 * Renders a personalized welcome and a compact at-a-glance stat strip computed
 * from the loader summary — the "living map" headline that grows as the user's
 * research grows. Pure and props-driven so it paints identically from the SSR
 * payload and from a client revalidation.
 */
import type { ResearchSummary } from "../server/research-summary";

/** A single labelled figure in the at-a-glance stat strip. */
interface HeroStat {
  /** The figure itself, already formatted for display. */
  value: string;
  /** Short caption explaining what the figure counts. */
  label: string;
}

interface ResearchHomeHeroProps {
  /** First name used in the greeting, or null when no name is available. */
  firstName: string | null;
  /** The aggregated research summary the stat strip is computed from. */
  summary: ResearchSummary;
}

/**
 * Returns the greeting line, personalized when a first name is known.
 *
 * @param firstName - The operator's first name, or null when unknown.
 * @returns The full greeting string.
 */
function greetingFor(firstName: string | null): string {
  return firstName ? `Welcome back, ${firstName}` : "Welcome back";
}

/**
 * Builds the at-a-glance stat strip from the research summary.
 *
 * @param summary - The aggregated research summary.
 * @returns The ordered list of stats to render.
 */
function buildStats(summary: ResearchSummary): HeroStat[] {
  const { totals, activity } = summary;
  const listLabel = totals.listCount === 1 ? "list" : "lists";
  const actorsLabel = totals.savedActors === 1 ? "actor" : "actors";
  const followLabel = activity.followedActorCount === 1 ? "actor" : "actors";
  const sourceLabel = activity.newSourcesThisWeek === 1 ? "new source" : "new sources";

  return [
    {
      value: `${totals.savedActors}`,
      label: `${actorsLabel} saved across ${totals.listCount} ${listLabel}`,
    },
    {
      value: `${activity.followedActorCount}`,
      label: `${followLabel} followed`,
    },
    {
      value: `${activity.newSourcesThisWeek}`,
      label: `${sourceLabel} this week`,
    },
  ];
}

/**
 * The home greeting plus the at-a-glance stat strip.
 */
export function ResearchHomeHero({ firstName, summary }: ResearchHomeHeroProps) {
  const stats = buildStats(summary);

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="type-label-medium text-ink-muted">Your research</p>
        <h1 className="type-display-small text-ink-strong">{greetingFor(firstName)}</h1>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="border-outline-variant bg-surface-container-lowest rounded-[1rem] border p-4"
          >
            <dt className="type-display-small text-ink-strong">{stat.value}</dt>
            <dd className="type-body-small text-ink-soft mt-1">{stat.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
