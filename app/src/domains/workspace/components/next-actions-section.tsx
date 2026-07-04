/**
 * "Suggested next actions" for the research home.
 *
 * Friendly, state-driven prompts that deep-link into the surface that moves the
 * user forward. The basic research prompts shrink as the research base fills
 * out; workspace prompts continue the sellable loop into briefs, coverage,
 * monitoring, and renewal proof.
 */
import { Link } from "@tanstack/react-router";
import type { AtlasBriefCollection } from "@/domains/workspace/server/briefs";
import type { CoverageTargetCollection } from "@/domains/workspace/server/coverage-targets";
import type { WorkspaceUsageSummary } from "@/domains/workspace/server/usage-summary";
import type { WorkspaceWatchCollection } from "@/domains/workspace/server/watches";
import type { ResearchSummary } from "../server/research-summary";
import type { OperatingPictureResource } from "./workspace-operating-picture-section";

/** Targets the suggestion links can deep-link into. */
type SuggestionTarget =
  | "/profiles"
  | "/lists"
  | "/discovery"
  | "/briefs/new"
  | "/coverage"
  | "/organization";

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
  /** Optional hash target for surfaces with an anchored proof packet. */
  hash?: string;
  /** Surface the action deep-links into. */
  to: SuggestionTarget;
}

export interface NextActionsWorkspaceState {
  briefs: OperatingPictureResource<AtlasBriefCollection>;
  coverageTargets: OperatingPictureResource<CoverageTargetCollection>;
  showRenewalProof: boolean;
  usageSummary: OperatingPictureResource<WorkspaceUsageSummary>;
  watches: OperatingPictureResource<WorkspaceWatchCollection>;
}

interface NextActionsSectionProps {
  /** The aggregated research summary the suggestions are computed from. */
  summary: ResearchSummary;
  /** Private workspace state that completes the sellable research workflow. */
  workspace?: NextActionsWorkspaceState;
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
function readyTotal<TData>(
  resource: OperatingPictureResource<TData>,
  total: (data: TData) => number,
): number | null {
  if (resource.status !== "ready") {
    return null;
  }

  return total(resource.data);
}

function buildWorkspaceActions(workspace: NextActionsWorkspaceState | undefined): NextAction[] {
  if (!workspace) {
    return [];
  }

  const actions: NextAction[] = [];
  const briefCount = readyTotal(workspace.briefs, (data) => data.total);
  const coverageTargetCount = readyTotal(workspace.coverageTargets, (data) => data.total);
  const watchCount = readyTotal(workspace.watches, (data) => data.total);
  const proofEventCount = readyTotal(workspace.usageSummary, (data) => data.total_events);

  if (briefCount === 0) {
    actions.push({
      id: "brief",
      title: "Create a brief",
      body: "Turn the current research into a source-linked memo.",
      cta: "New brief",
      to: "/briefs/new",
    });
  }

  if (coverageTargetCount === 0) {
    actions.push({
      id: "coverage",
      title: "Define coverage",
      body: "Name the places, issues, actors, and sources that still need proof.",
      cta: "Open coverage",
      to: "/coverage",
    });
  }

  if (watchCount === 0) {
    actions.push({
      id: "monitoring",
      title: "Choose monitoring",
      body: "Keep one actor or coverage target in recurring review.",
      cta: "Choose monitoring",
      to: "/coverage",
    });
  }

  if (
    workspace.showRenewalProof &&
    actions.length === 0 &&
    proofEventCount !== null &&
    proofEventCount > 0
  ) {
    actions.push({
      hash: "renewal-proof",
      id: "proof",
      title: "Review renewal proof",
      body: "Use public-record improvements and work totals in the next renewal conversation.",
      cta: "Open proof",
      to: "/organization",
    });
  }

  return actions;
}

function buildActions(
  summary: ResearchSummary,
  workspace?: NextActionsWorkspaceState,
): NextAction[] {
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

  return [...actions, ...buildWorkspaceActions(workspace)];
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
      <Link hash={action.hash} to={action.to} className="type-label-large text-accent underline">
        {action.cta}
      </Link>
    </div>
  );
}

/**
 * The home suggested-next-actions section, hiding entirely when there is no
 * useful next move to show.
 */
export function NextActionsSection({ summary, workspace }: NextActionsSectionProps) {
  const actions = buildActions(summary, workspace);

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
