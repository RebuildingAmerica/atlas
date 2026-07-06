import { humanizeSlug } from "../../lib/humanize-slug";

/**
 * Human labels for Atlas's known verification tiers. Covers both
 * `trust.level` (underscored: `atlas_verified`) and `claim.verification_level`
 * (hyphenated: `atlas-verified`) spellings, since callers may pass either —
 * this component is intentionally generic (see `TrustBadgeRowProps`) so it
 * isn't coupled to one specific field on the full entity payload.
 */
const KNOWN_VERIFICATION_LABELS: Record<string, string> = {
  subject_verified: "Subject-verified",
  "subject-verified": "Subject-verified",
  atlas_verified: "Atlas-verified",
  "atlas-verified": "Atlas-verified",
  corroborated: "Corroborated",
  "source-derived": "Source-derived",
  unverified: "Unverified",
};

/** Verification levels strong enough to earn the "✓" prefix. */
const VERIFIED_LEVELS = new Set([
  "atlas_verified",
  "atlas-verified",
  "subject_verified",
  "subject-verified",
]);

/**
 * Turn a raw verification-level string into a human label. Falls back to
 * `humanizeSlug` (title-casing the raw value) for any level this component
 * doesn't recognize by name, so an unexpected value still renders something
 * reasonable instead of a raw enum string.
 */
function humanizeVerificationLevel(level: string): string {
  return KNOWN_VERIFICATION_LABELS[level] ?? humanizeSlug(level);
}

export interface TrustBadgeRowProps {
  /** Raw verification-level string, e.g. `trust.level` or `claim.verification_level`. */
  verificationLevel: string;
  sourceCount: number;
}

/**
 * Two small pill badges: a verification/trust badge and a source-count
 * badge. Kept generic and standalone (plain strings/numbers in, no
 * dependency on `EntityCardData`) so it's reusable outside the entity card.
 *
 * A prior attempt to have the main app's `entry-card.tsx`/`entry-detail.tsx`
 * consume this component in place of their own inline badge rendering was
 * deliberately not carried out, and the concrete, verified blocker is this
 * component's `sourceLabel` below: it hardcodes `"N sources"`/`"1 source"`
 * and isn't parameterizable, while both app files render different, tested
 * text — `pluralize(entry.source_count, "source packet")`, i.e.
 * `"N source packets"`/`"1 source packet"` — for the same count. Swapping
 * either file to this component as-is would silently change that displayed
 * text. (There are further blockers too — the app's `Badge` variants vs.
 * this component's `ew-*`-token pill styling, and badge ordering relative
 * to other badges on the same row — but this text mismatch alone is enough
 * to rule out a drop-in replacement without a parameterizable source-count
 * label, or a design that separates the verification pill from the
 * source-count pill entirely.)
 */
export function TrustBadgeRow({
  verificationLevel,
  sourceCount,
}: TrustBadgeRowProps) {
  const isVerified = VERIFIED_LEVELS.has(verificationLevel);
  const label = humanizeVerificationLevel(verificationLevel);
  const sourceLabel = sourceCount === 1 ? "1 source" : `${sourceCount} sources`;

  const verificationBadgeClassName = isVerified
    ? "bg-ew-accent text-ew-accent-ink inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
    : "bg-ew-muted text-ew-muted-ink inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={verificationBadgeClassName}>
        {isVerified ? `✓ ${label}` : label}
      </span>
      <span className="bg-ew-muted text-ew-muted-ink inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
        {sourceLabel}
      </span>
    </div>
  );
}
