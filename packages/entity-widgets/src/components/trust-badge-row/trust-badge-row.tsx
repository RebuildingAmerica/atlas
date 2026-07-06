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
 * title-casing the raw value (splitting on `-`/`_`) for any level this
 * component doesn't recognize by name, so an unexpected value still renders
 * something reasonable instead of a raw enum string.
 */
function humanizeVerificationLevel(level: string): string {
  const known = KNOWN_VERIFICATION_LABELS[level];
  if (known) {
    return known;
  }
  return level
    .split(/[-_]/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface TrustBadgeRowProps {
  /** Raw verification-level string, e.g. `trust.level` or `claim.verification_level`. */
  verificationLevel: string;
  sourceCount: number;
}

/**
 * Two small pill badges: a verification/trust badge and a source-count
 * badge. Kept generic and standalone (plain strings/numbers in, no
 * dependency on `EntityCardData`) so it's reusable outside the entity card —
 * a later task replaces duplicated badge-rendering logic in the main app's
 * `entry-card.tsx`/`entry-detail.tsx` with this same component.
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
