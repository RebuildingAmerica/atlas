/**
 * DataQualityBlock — provenance + verification panel for profile pages.
 *
 * Surfaces first-seen, last-activity freshness, source count, and the
 * verification line. The verification row also carries an inline claim link
 * for unclaimed profiles, so the claim affordance lives in context (a subject
 * looking at how they're represented) rather than as a top-of-page banner.
 */
import { Link } from "@tanstack/react-router";
import { CheckCircle2, MessageSquareWarning, ShieldCheck, ShieldQuestion } from "lucide-react";
import {
  FreshnessChip,
  formatFreshness,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { LeadQualitySignals } from "@/domains/catalog/components/profiles/lead-quality-signals";
import type { ClaimEvidenceInfo, Entry } from "@/types";

interface DataQualityBlockProps {
  entry: Entry;
}

interface ProfileShapeSlot {
  label: string;
  present: boolean;
}

const ACTOR_QUALITY_LABELS: Record<string, string> = {
  actor: "Actor",
  work: "Work",
  place: "Place",
  issues: "Issues",
  sources: "Sources",
};

const ACTOR_QUALITY_LEVEL_LABELS: Record<string, string> = {
  specific_actor: "Specific actor",
  partial_actor: "Partial actor",
  thin_record: "Thin record",
};

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

  const level = entry.trust.level;
  if (level === "atlas_verified") {
    return (
      <span className="type-body-medium text-ink-strong inline-flex items-center gap-1.5">
        <CheckCircle2 className="text-civic h-4 w-4" aria-hidden />
        Atlas-verified
      </span>
    );
  }

  if (level === "corroborated") {
    const count = entry.trust.independent_source_count;
    const label =
      count !== null
        ? `Corroborated · ${count} independent ${count === 1 ? "source" : "sources"}`
        : "Corroborated";
    return (
      <span className="type-body-medium text-ink-strong inline-flex items-center gap-1.5">
        <CheckCircle2 className="text-civic h-4 w-4" aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <span className="type-body-medium text-ink-soft inline-flex items-center gap-1.5">
      <ShieldQuestion className="text-ink-muted h-4 w-4" aria-hidden />
      Single source
    </span>
  );
}

function formatEvidenceDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatClaimEvidence(evidence: ClaimEvidenceInfo): string {
  const sourceLabel = `${evidence.source_count} ${evidence.source_count === 1 ? "source" : "sources"}`;
  const dateLabel = formatEvidenceDate(evidence.as_of);
  return [sourceLabel, evidence.confidence, dateLabel].filter(Boolean).join(" · ");
}

function ClaimEvidenceBlock({ entry }: { entry: Entry }) {
  const evidence = entry.claim_evidence;
  if (!evidence) return null;

  const rows = [
    ["Summary", evidence.summary],
    ["Place", evidence.place],
    ["Issues", evidence.issues],
    ["Contact", evidence.contact],
  ] as const;

  return (
    <div className="space-y-2">
      <dt>
        <h3 className="type-label-small text-ink-muted">Claim evidence</h3>
      </dt>
      <dd className="grid gap-2">
        {rows.map(([label, item]) => (
          <div
            key={label}
            className="border-border bg-surface-container-low flex items-baseline justify-between gap-3 rounded-lg border px-3 py-2"
          >
            <span className="type-label-medium text-ink-strong">{label}</span>
            <span className="type-body-small text-ink-soft text-right">
              {formatClaimEvidence(item)}
            </span>
          </div>
        ))}
      </dd>
    </div>
  );
}

function hasSocialMedia(entry: Entry): boolean {
  return Boolean(entry.social_media && Object.values(entry.social_media).some((value) => value));
}

function profileShapeSlots(entry: Entry): ProfileShapeSlot[] {
  return [
    { label: "Identity", present: Boolean(entry.name && entry.type) },
    { label: "Work", present: Boolean(entry.description || entry.custom_bio) },
    {
      label: "Place",
      present: Boolean(entry.city || entry.state || entry.region || entry.full_address),
    },
    { label: "Issues", present: entry.issue_areas.length > 0 },
    { label: "Sources", present: entry.source_count > 0 },
    {
      label: "Contact",
      present: Boolean(entry.website || entry.email || entry.phone || hasSocialMedia(entry)),
    },
  ];
}

function ProfileShapeBlock({ entry }: { entry: Entry }) {
  const slots = profileShapeSlots(entry);
  const presentCount = slots.filter((slot) => slot.present).length;
  const missing = slots.filter((slot) => !slot.present).map((slot) => slot.label);

  return (
    <div className="space-y-2">
      <dt className="type-label-small text-ink-muted">Profile shape</dt>
      <dd className="space-y-2">
        <p className="type-body-small text-ink-soft">
          {presentCount} of {slots.length} core fields
        </p>
        <div className="flex flex-wrap gap-1.5" aria-label="Canonical profile fields">
          {slots.map((slot) => (
            <span
              key={slot.label}
              className={
                "type-label-small rounded-full px-2 py-0.5 " +
                (slot.present
                  ? "bg-surface-container-low text-ink-strong"
                  : "bg-surface-alt text-ink-muted")
              }
            >
              {slot.label}
            </span>
          ))}
        </div>
        {missing.length > 0 ? (
          <p className="type-label-small text-ink-muted">Missing {missing.join(", ")}</p>
        ) : null}
      </dd>
    </div>
  );
}

function formatActorQualitySlot(value: string): string {
  return ACTOR_QUALITY_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}

function ActorSpecificityBlock({ entry }: { entry: Entry }) {
  const quality = entry.actor_quality;
  if (!quality) return null;
  const missing = quality.missing.map(formatActorQualitySlot);
  const present = quality.present.map(formatActorQualitySlot);
  const levelLabel = ACTOR_QUALITY_LEVEL_LABELS[quality.level] ?? "Thin record";

  return (
    <div className="space-y-2">
      <dt className="type-label-small text-ink-muted">Actor specificity</dt>
      <dd className="space-y-2">
        <p className="type-body-small text-ink-soft">
          {quality.score} of {quality.total} specificity signals
        </p>
        <div className="flex flex-wrap gap-1.5" aria-label="Actor specificity signals">
          <span className="type-label-small bg-surface-container-low text-ink-strong rounded-full px-2 py-0.5">
            {levelLabel}
          </span>
          {present.map((label) => (
            <span
              key={label}
              className="type-label-small bg-surface-container-low text-ink-strong rounded-full px-2 py-0.5"
            >
              {label}
            </span>
          ))}
        </div>
        {missing.length > 0 ? (
          <p className="type-label-small text-ink-muted">Missing {missing.join(", ")}</p>
        ) : null}
      </dd>
    </div>
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

function StewardshipBlock({ entry }: { entry: Entry }) {
  return (
    <section className="border-border space-y-3 border-t pt-3">
      <div className="flex items-start gap-2">
        <MessageSquareWarning className="text-civic mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <h3 className="type-label-medium text-ink-strong">Corrections</h3>
          <p className="type-body-small text-ink-soft">
            Report representation, freshness, or context issues.
          </p>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Link
          to="/claim/$slug"
          params={{ slug: entry.slug }}
          className="type-body-small text-civic hover:text-civic-deep font-medium underline-offset-2 hover:underline"
        >
          Claim or correct representation
        </Link>
        <Link
          to="/feedback/$slug"
          params={{ slug: entry.slug }}
          search={{ kind: "incorrect" }}
          className="type-body-small text-civic hover:text-civic-deep font-medium underline-offset-2 hover:underline"
        >
          Report stale or incorrect information
        </Link>
        <Link
          to="/feedback/$slug"
          params={{ slug: entry.slug }}
          search={{ kind: "missing_context" }}
          className="type-body-small text-civic hover:text-civic-deep font-medium underline-offset-2 hover:underline"
        >
          Suggest missing context
        </Link>
      </div>
    </section>
  );
}

export function DataQualityBlock({ entry }: DataQualityBlockProps) {
  const freshnessSource = entry.latest_source_date ?? entry.last_seen;
  const freshness = formatFreshness(freshnessSource);

  return (
    <div className="space-y-4">
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
          <dt className="type-label-small text-ink-muted">Lead signals</dt>
          <dd>
            <LeadQualitySignals entry={entry} />
          </dd>
        </div>
        <ActorSpecificityBlock entry={entry} />
        <ProfileShapeBlock entry={entry} />
        <div className="space-y-1">
          <dt>
            <h3 className="type-label-small text-ink-muted">Verification</h3>
          </dt>
          <dd className="space-y-1.5">
            <VerificationLine entry={entry} />
            <ClaimLink entry={entry} />
          </dd>
        </div>
        <ClaimEvidenceBlock entry={entry} />
      </dl>

      <StewardshipBlock entry={entry} />
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
