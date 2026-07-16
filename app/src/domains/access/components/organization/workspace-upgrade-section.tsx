import { ArrowUpCircle } from "lucide-react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { computeTeamSeatCostSummary, formatUsdFromCents } from "@/domains/billing/team-cost";

/**
 * Props for the upgrade-to-team section shown on individual workspaces.
 */
interface WorkspaceUpgradeSectionProps {
  isPending: boolean;
  memberCount: number;
  onUpgrade: () => void;
}

/**
 * Upgrade prompt for an individual workspace the operator manages.
 *
 * Explains that a workspace can become a team in place and previews the
 * recurring Atlas Team cost for the current member count so the operator sees
 * an accurate price before upgrading. Inviting still requires a subscription,
 * which the operator starts on the pricing page after upgrading.
 */
export function WorkspaceUpgradeSection({
  isPending,
  memberCount,
  onUpgrade,
}: WorkspaceUpgradeSectionProps) {
  const summary = computeTeamSeatCostSummary(memberCount, "monthly");
  const memberLabel = summary.seatsUsed === 1 ? "member" : "members";

  return (
    <article className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">Upgrade to a team</h2>
        <p className="type-body-medium text-ink-soft">
          Turn this workspace into a team to invite collaborators and manage shared research. Your
          members, billing, and identity carry over — only inviting requires an Atlas Team
          subscription.
        </p>
      </div>

      <div className="border-border bg-surface-container-lowest space-y-1 rounded-[1.25rem] border p-4">
        <p className="type-title-small text-ink-strong">
          Your {summary.seatsUsed} {memberLabel} → {formatUsdFromCents(summary.totalCents)} per
          month on Atlas Team
        </p>
        <p className="type-body-small text-ink-muted">
          {formatUsdFromCents(summary.baseCents)} base
          {summary.additionalSeats > 0
            ? ` + ${summary.additionalSeats} × ${formatUsdFromCents(summary.perSeatCents)} per month`
            : " · no additional seats yet"}
        </p>
      </div>

      <Button disabled={isPending} onClick={onUpgrade}>
        <span className="inline-flex items-center gap-2">
          <ArrowUpCircle className="h-4 w-4" />
          {isPending ? "Upgrading..." : "Upgrade to a team workspace"}
        </span>
      </Button>
    </article>
  );
}
