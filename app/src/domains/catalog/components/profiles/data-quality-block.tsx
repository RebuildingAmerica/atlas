/**
 * DataQualityBlock — sidebar block surfacing how Atlas knows what it knows.
 *
 * Shows trust signals: first surfaced, freshness, Atlas-verified flag, source
 * count. Phase 1 uses only existing entry fields; subject-claim status and
 * verification level land in Phase 2.
 */
import { CheckCircle2, ShieldQuestion } from "lucide-react";
import {
  FreshnessChip,
  formatFreshness,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import type { Entry } from "@/types";

interface DataQualityBlockProps {
  entry: Entry;
}

function formatAbsoluteDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

export function DataQualityBlock({ entry }: DataQualityBlockProps) {
  const freshnessSource = entry.latest_source_date ?? entry.last_seen;
  const freshness = formatFreshness(freshnessSource);

  return (
    <div className="space-y-4">
      <p className="type-label-medium text-ink-muted">Data quality</p>

      <dl className="space-y-3">
        <Row
          label="First surfaced"
          value={
            <span className="type-body-medium text-ink-strong">
              {formatAbsoluteDate(entry.first_seen)}
            </span>
          }
        />
        <Row
          label="Last activity"
          value={<FreshnessChip isoDate={freshnessSource} prefix="" />}
          aside={`${freshness.daysAgo}d ago`}
        />
        <Row
          label="Sources"
          value={
            <span className="type-body-medium text-ink-strong">
              {entry.source_count} {entry.source_count === 1 ? "source" : "sources"}
            </span>
          }
        />
        <Row
          label="Verification"
          value={
            entry.verified ? (
              <span className="type-body-medium text-ink-strong inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                Atlas verified
              </span>
            ) : (
              <span className="type-body-medium text-ink-soft inline-flex items-center gap-1.5">
                <ShieldQuestion className="text-ink-muted h-4 w-4" aria-hidden />
                Source-derived
              </span>
            )
          }
        />
      </dl>
    </div>
  );
}

function Row({ label, value, aside }: { label: string; value: React.ReactNode; aside?: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="type-label-small text-ink-muted">{label}</dt>
      <dd className="flex items-baseline justify-between gap-2">
        {value}
        {aside ? <span className="type-label-small text-ink-muted">{aside}</span> : null}
      </dd>
    </div>
  );
}
