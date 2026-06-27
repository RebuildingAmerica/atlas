/**
 * In-context, honest paid-value nudge for the authenticated research home.
 *
 * A capability-aware card placed at the moment of value: it renders only when
 * the relevant paid gate is genuinely unmet and never in local mode, and it
 * always links to {@link "/pricing"} with the matching intent rather than
 * showing a fake button or a blocking wall. The copy is framed as "what you'd
 * unlock", so the user discovers value before ever hitting a limit.
 */
import { Link } from "@tanstack/react-router";
import {
  getSerializedLimit,
  hasSerializedCapability,
  type SerializedResolvedCapabilities,
} from "@/domains/access/capabilities";
import type { PricingSearch } from "@/domains/billing/pages/public/pricing-page";

/** Pricing intent the nudge routes to, matching the pricing route's enum. */
type ResearchValueIntent = NonNullable<PricingSearch["intent"]>;

/**
 * The Export-a-list nudge, shown on a list card with items when the workspace
 * lacks the export capability.
 */
interface ExportGate {
  kind: "export";
  /** How many actors the list holds — the nudge only appears above zero. */
  itemCount: number;
}

/**
 * The alerts/Watchlists nudge, shown on the follows section once the user is
 * tracking at least one actor and lacks the watchlists capability.
 */
interface AlertsGate {
  kind: "alerts";
  /** How many actors the user follows — the nudge only appears above zero. */
  followedActorCount: number;
}

/**
 * The "unlock unlimited" nudge, shown to free-tier users who are nearing any of
 * their free saved-actor, list, or monthly-request allowances.
 */
interface UnlimitedGate {
  kind: "unlimited";
  /** Whether the user is on the free tier (no active paid products). */
  isFreeTier: boolean;
  /** Total actors saved across the user's lists. */
  savedActors: number;
  /** How many lists the user has created. */
  listCount: number;
  /** Research requests the user has started in the current month. */
  runsThisMonth: number;
}

/** The set of moment-of-value gates the nudge can represent. */
export type ResearchValueGate = ExportGate | AlertsGate | UnlimitedGate;

interface ResearchValueNudgeProps {
  /** The serialized capability/limit set from the session, or null when none. */
  capabilities: SerializedResolvedCapabilities | null;
  /** Whether the deployment is running in local (single-user) mode. */
  isLocal: boolean;
  /** Which moment-of-value gate this nudge represents. */
  gate: ResearchValueGate;
}

/** The resolved copy and pricing intent for a nudge that should render. */
interface NudgeContent {
  title: string;
  body: string;
  cta: string;
  intent: ResearchValueIntent;
}

/** The fraction of a free limit at which the "nearing" nudge begins to show. */
const NEARING_LIMIT_THRESHOLD = 0.8;

/**
 * Whether a current count is at or beyond the nudge threshold for a free limit.
 *
 * A null limit means "unlimited", which never nears anything. A non-positive
 * limit is treated as already met so the user is never left without a path
 * forward.
 *
 * @param current - The user's current count toward the limit.
 * @param limit - The free-tier allowance, or null when unbounded.
 * @returns Whether the count is close enough to the limit to nudge.
 */
function isNearingLimit(current: number, limit: number | null): boolean {
  if (limit === null) {
    return false;
  }
  if (limit <= 0) {
    return true;
  }
  return current >= limit * NEARING_LIMIT_THRESHOLD;
}

/**
 * Resolve the copy and intent for the export nudge, or null when it should hide.
 */
function exportContent(
  gate: ExportGate,
  capabilities: SerializedResolvedCapabilities,
): NudgeContent | null {
  if (gate.itemCount <= 0 || hasSerializedCapability(capabilities, "workspace.export")) {
    return null;
  }
  return {
    title: "Export this list",
    body: "Download this list as a CSV to share or work it elsewhere — exports come with Atlas Pro.",
    cta: "See what Pro unlocks",
    intent: "atlas_pro",
  };
}

/**
 * Resolve the copy and intent for the alerts nudge, or null when it should hide.
 */
function alertsContent(
  gate: AlertsGate,
  capabilities: SerializedResolvedCapabilities,
): NudgeContent | null {
  if (
    gate.followedActorCount < 1 ||
    hasSerializedCapability(capabilities, "monitoring.watchlists")
  ) {
    return null;
  }
  const actorsLabel = gate.followedActorCount === 1 ? "actor" : "actors";
  return {
    title: "Get alerts when they're in the news",
    body: `You're tracking ${gate.followedActorCount} ${actorsLabel}. Get an email the moment they appear in a new source — with Watchlists on Atlas Team.`,
    cta: "See what Team unlocks",
    intent: "atlas_team",
  };
}

/**
 * Resolve the copy and intent for the unlimited nudge, or null when it hides.
 *
 * Only free-tier users see it, and only once they are nearing one of their
 * saved-actor, list, or monthly-request allowances.
 */
function unlimitedContent(
  gate: UnlimitedGate,
  capabilities: SerializedResolvedCapabilities,
): NudgeContent | null {
  if (!gate.isFreeTier) {
    return null;
  }

  const entriesLimit = getSerializedLimit(capabilities, "max_shortlist_entries");
  const listsLimit = getSerializedLimit(capabilities, "max_shortlists");
  const runsLimit = getSerializedLimit(capabilities, "research_runs_per_month");

  const nearingEntries = isNearingLimit(gate.savedActors, entriesLimit);
  const nearingLists = isNearingLimit(gate.listCount, listsLimit);
  const nearingRuns = isNearingLimit(gate.runsThisMonth, runsLimit);

  if (!nearingEntries && !nearingLists && !nearingRuns) {
    return null;
  }

  const listLabel = gate.listCount === 1 ? "list" : "lists";
  return {
    title: "Unlock unlimited research",
    body: `You've saved ${gate.savedActors} across ${gate.listCount} free ${listLabel}. Unlock unlimited lists, saved actors, and monthly research with Atlas Pro.`,
    cta: "See what Pro unlocks",
    intent: "atlas_pro",
  };
}

/**
 * Resolve the nudge content for a gate, or null when the nudge should hide.
 */
function resolveContent(
  gate: ResearchValueGate,
  capabilities: SerializedResolvedCapabilities,
): NudgeContent | null {
  if (gate.kind === "export") {
    return exportContent(gate, capabilities);
  }
  if (gate.kind === "alerts") {
    return alertsContent(gate, capabilities);
  }
  return unlimitedContent(gate, capabilities);
}

/**
 * The in-context paid-value nudge card.
 *
 * Renders nothing in local mode, when no session capabilities are available, or
 * when the gate is already satisfied. Otherwise it shows honest "what you'd
 * unlock" copy and a link to the matching pricing intent.
 */
export function ResearchValueNudge({ capabilities, isLocal, gate }: ResearchValueNudgeProps) {
  if (isLocal || capabilities === null) {
    return null;
  }

  const content = resolveContent(gate, capabilities);
  if (content === null) {
    return null;
  }

  return (
    <section className="border-border-strong bg-surface rounded-[1rem] border p-4">
      <p className="type-title-small text-ink-strong">{content.title}</p>
      <p className="type-body-small text-ink-soft mt-1">{content.body}</p>
      <div className="mt-3">
        <Link
          to="/pricing"
          search={{ intent: content.intent }}
          className="type-label-large text-ink-strong underline"
        >
          {content.cta}
        </Link>
      </div>
    </section>
  );
}
