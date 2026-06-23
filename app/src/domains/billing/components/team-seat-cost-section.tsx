import {
  describeSeatsUsed,
  formatUsdFromCents,
  intervalCadenceLabel,
  type TeamSeatCostSummary,
} from "../team-cost";

/**
 * Props for the Team seat-and-cost summary section.
 */
interface TeamSeatCostSectionProps {
  summary: TeamSeatCostSummary | null;
}

/**
 * Seat usage and recurring-cost summary for the active Atlas Team workspace.
 *
 * Renders nothing until the summary loads so the members panel never shows a
 * partial or guessed price.
 */
export function TeamSeatCostSection({ summary }: TeamSeatCostSectionProps) {
  if (summary === null) {
    return null;
  }

  const cadence = intervalCadenceLabel(summary.interval);
  return (
    <article className="border-border bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">Seats &amp; cost</h2>
        <p className="type-body-medium text-ink-soft">{describeSeatsUsed(summary)}</p>
      </div>
      <div className="border-border bg-surface-container-lowest space-y-2 rounded-[1.25rem] border p-4">
        <p className="type-title-small text-ink-strong">
          {formatUsdFromCents(summary.totalCents)} {cadence}
        </p>
        <p className="type-body-small text-ink-muted">
          {formatUsdFromCents(summary.baseCents)} base
          {summary.additionalSeats > 0
            ? ` + ${summary.additionalSeats} × ${formatUsdFromCents(summary.perSeatCents)} ${cadence}`
            : " · no additional seats yet"}
        </p>
      </div>
    </article>
  );
}
