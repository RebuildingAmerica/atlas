import { Link } from "@tanstack/react-router";

/**
 * Props for the discovery hero section.
 */
interface DiscoveryHeroProps {
  description: string;
  eyebrow: string;
  title: string;
  workspaceBadge: string | null;
}

/**
 * Hero band at the top of the discovery surface.  Shows the eyebrow,
 * heading, optional workspace badge, and the longer descriptive copy.
 */
export function DiscoveryHero({ description, eyebrow, title, workspaceBadge }: DiscoveryHeroProps) {
  return (
    <section className="space-y-3">
      <p className="type-label-medium text-ink-muted">{eyebrow}</p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="type-headline-large text-ink-strong">{title}</h1>
        {workspaceBadge ? (
          <span className="type-label-large border-border text-ink-soft rounded-full border px-3 py-1">
            {workspaceBadge}
          </span>
        ) : null}
      </div>
      <p className="type-body-large text-ink-soft max-w-3xl">{description}</p>
    </section>
  );
}

/**
 * Props for the discovery setup notice.
 */
interface DiscoverySetupNoticeProps {
  body: string;
  cta: string;
  title: string;
}

/**
 * Notice card pointing the operator at the workspace setup surface when
 * Atlas detects a missing workspace or pending invitations.
 */
export function DiscoverySetupNotice({ body, cta, title }: DiscoverySetupNoticeProps) {
  return (
    <section className="border-border-strong bg-surface rounded-[1.5rem] border p-5">
      <p className="type-title-medium text-ink-strong">{title}</p>
      <p className="type-body-medium text-ink-soft mt-2">{body}</p>
      <div className="mt-4">
        <Link className="type-label-large text-ink-strong underline" to="/organization">
          {cta}
        </Link>
      </div>
    </section>
  );
}

/**
 * Which moment drives the discovery upgrade nudge.  `at-limit` is the
 * in-the-moment case: the operator just tried to start a run and was
 * blocked because they have used their monthly research allowance.
 */
type DiscoveryUpgradeReason = "free-tier" | "capability-missing" | "at-limit";

interface DiscoveryUpgradePromptProps {
  reason: DiscoveryUpgradeReason;
}

/** Resolved copy and call-to-action for a discovery upgrade nudge. */
interface DiscoveryUpgradeContent {
  title: string;
  body: string;
  cta: string;
}

const DISCOVERY_UPGRADE_CONTENT: Record<DiscoveryUpgradeReason, DiscoveryUpgradeContent> = {
  "capability-missing": {
    title: "Discovery runs are paused on your plan",
    body: "Your workspace doesn't have access to discovery runs right now. Upgrade to Atlas Pro for unlimited research, or buy a Research Pass for short-term project access.",
    cta: "See plans",
  },
  "free-tier": {
    title: "On the free plan",
    body: "The free plan caps discovery runs at 2 per month. Upgrade to Atlas Pro for unlimited runs, exports, and API access.",
    cta: "See plans",
  },
  "at-limit": {
    title: "You've used your free runs this month",
    body: "The free plan includes 2 discovery runs per month, and you've used them all. Upgrade to Atlas Pro for unlimited runs, exports, and API access.",
    cta: "Upgrade",
  },
};

/**
 * Upgrade-nudge card shown when the active workspace's plan does not
 * include unrestricted discovery runs.  Routes the operator to /pricing,
 * carrying the Atlas Pro intent so the plan is pre-selected on arrival.
 */
export function DiscoveryUpgradePrompt({ reason }: DiscoveryUpgradePromptProps) {
  const content = DISCOVERY_UPGRADE_CONTENT[reason];

  return (
    <section className="border-border-strong bg-surface rounded-[1.5rem] border p-5">
      <p className="type-title-medium text-ink-strong">{content.title}</p>
      <p className="type-body-medium text-ink-soft mt-2">{content.body}</p>
      <div className="mt-4">
        <Link
          className="type-label-large text-ink-strong underline"
          to="/pricing"
          search={{ intent: "atlas_pro" }}
        >
          {content.cta}
        </Link>
      </div>
    </section>
  );
}
