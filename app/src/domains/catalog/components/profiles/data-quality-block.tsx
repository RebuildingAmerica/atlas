/**
 * DataQualityBlock — provenance + verification panel for profile pages.
 *
 * Surfaces first-seen, last-activity freshness, source count, and the
 * verification line. The verification row also carries an inline claim link
 * for unclaimed profiles, so the claim affordance lives in context (a subject
 * looking at how they're represented) rather than as a top-of-page banner.
 */
import { Link } from "@tanstack/react-router";
import { CheckCircle2, ShieldCheck, ShieldQuestion } from "lucide-react";
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

function VerificationLine({ entry }: { entry: Entry }) {
  const status = entry.claim.status;

  if (status === "verified") {
    const verifiedAt = entry.claim.claim_verified_at;
    const dateLabel = verifiedAt ? formatAbsoluteDate(verifiedAt) : null;
    return (
      <span className="type-body-medium text-ink-strong inline-flex items-center gap-1.5">
        <ShieldCheck className="text-civic h-4 w-4" aria-hidden />
        Verified by subject{dateLabel ? ` — ${dateLabel}` : ""}
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className="type-body-medium text-ink-soft inline-flex items-center gap-1.5">
        <ShieldQuestion className="text-ink-muted h-4 w-4" aria-hidden />
        Claim under review
      </span>
    );
  }

  if (entry.verified) {
    return (
      <span className="type-body-medium text-ink-strong inline-flex items-center gap-1.5">
        <CheckCircle2 className="text-civic h-4 w-4" aria-hidden />
        Atlas-verified
      </span>
    );
  }

  return (
    <span className="type-body-medium text-ink-soft inline-flex items-center gap-1.5">
      <ShieldQuestion className="text-ink-muted h-4 w-4" aria-hidden />
      Source-derived
    </span>
  );
}

function ClaimLink({ entry }: { entry: Entry }) {
  const status = entry.claim.status;
  if (status === "verified" || status === "pending") return null;

  const label =
    status === "revoked" ? "Claim this profile →" : `Are you ${entry.name}? Claim this profile →`;

  return (
    <Link
      to="/claim/$slug"
      params={{ slug: entry.slug }}
      className="type-body-small text-civic hover:text-civic-deep block font-medium underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  );
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
        <div className="space-y-1">
          <dt className="type-label-small text-ink-muted">Verification</dt>
          <dd className="space-y-1.5">
            <VerificationLine entry={entry} />
            <ClaimLink entry={entry} />
          </dd>
        </div>
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
