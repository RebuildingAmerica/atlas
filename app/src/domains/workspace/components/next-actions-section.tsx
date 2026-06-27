/**
 * "Suggested next actions" for the research home.
 *
 * Friendly, state-driven prompts that deep-link into the surface that completes
 * them — and that hide once the user has already done them, so the section
 * shrinks as the research base fills out. When every suggestion is satisfied,
 * the section renders nothing rather than nagging.
 */
import { Link } from "@tanstack/react-router";
import type { ResearchSummary } from "../server/research-summary";

/** Targets the suggestion links can deep-link into. */
type SuggestionTarget = "/profiles" | "/lists" | "/discovery";

/** A single suggested next action. */
interface NextAction {
  /** Stable key for the suggestion. */
  id: string;
  /** Headline describing the action. */
  title: string;
  /** Short supporting copy. */
  body: string;
  /** Link label for the deep link. */
  cta: string;
  /** Surface the action deep-links into. */
  to: SuggestionTarget;
}

interface NextActionsSectionProps {
  /** The aggregated research summary the suggestions are computed from. */
  summary: ResearchSummary;
}

/**
 * Computes the suggestions that still apply for the current research state.
 *
 * Each suggestion is omitted once the user has done it, so the list only ever
 * offers genuinely useful next steps.
 *
 * @param summary - The aggregated research summary.
 * @returns The suggestions to render, in priority order.
 */
function buildActions(summary: ResearchSummary): NextAction[] {
  const actions: NextAction[] = [];

  if (summary.activity.followedActorCount === 0) {
    actions.push({
      id: "follow",
      title: "Follow an actor",
      body: "Start your activity feed by tracking someone you care about.",
      cta: "Browse profiles",
      to: "/profiles",
    });
  }

  if (summary.totals.listCount === 0) {
    actions.push({
      id: "list",
      title: "Create a themed list",
      body: "Group saved actors into a research thread or outreach push.",
      cta: "Start a list",
      to: "/lists",
    });
  }

  if (summary.recentRuns.length === 0) {
    actions.push({
      id: "search",
      title: "Start your first research request",
      body: "Discover people and organizations working on an issue near you.",
      cta: "Start research",
      to: "/discovery",
    });
  }

  return actions;
}

interface NextActionCardProps {
  /** The suggestion this card renders. */
  action: NextAction;
}

/**
 * A single suggested-action card with a deep link.
 */
function NextActionCard({ action }: NextActionCardProps) {
  return (
    <div className="border-outline-variant bg-surface-container-lowest space-y-2 rounded-[1rem] border p-4">
      <p className="type-title-medium text-ink-strong">{action.title}</p>
      <p className="type-body-small text-ink-soft">{action.body}</p>
      <Link to={action.to} className="type-label-large text-accent underline">
        {action.cta}
      </Link>
    </div>
  );
}

/**
 * The home suggested-next-actions section, hiding entirely when nothing is left
 * to suggest.
 */
export function NextActionsSection({ summary }: NextActionsSectionProps) {
  const actions = buildActions(summary);

  if (actions.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <h2 className="type-headline-small text-ink-strong">Suggested next steps</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {actions.map((action) => (
          <NextActionCard key={action.id} action={action} />
        ))}
      </div>
    </section>
  );
}
