/**
 * Operator-facing severity for a stored signing certificate, derived from
 * its `notAfter` timestamp.  Atlas surfaces the severity as a badge on the
 * provider card so an admin can spot expiring certificates at a glance —
 * red after expiry, amber inside the seven-day window, yellow inside the
 * thirty-day window, and otherwise none.
 */
export type CertExpirySeverity = "expired" | "critical" | "warning" | "ok";

export interface CertExpiryAssessment {
  daysUntil: number;
  severity: CertExpirySeverity;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Evaluates a certificate's expiry timestamp against `now` and returns the
 * severity bucket plus a normalized "days until" value.  Returns null when
 * the timestamp is missing or unparseable, so callers can hide the badge
 * entirely instead of rendering placeholder copy.
 *
 * @param notAfter - The certificate `notAfter` value from Better Auth.
 * @param now - Reference timestamp; defaults to `Date.now()`.
 */
export function assessCertExpiry(
  notAfter: string | null | undefined,
  now: number = Date.now(),
): CertExpiryAssessment | null {
  if (!notAfter) return null;
  const expiry = new Date(notAfter).getTime();
  if (Number.isNaN(expiry)) return null;
  const daysUntil = Math.round((expiry - now) / MS_PER_DAY);
  if (daysUntil < 0) {
    return { daysUntil, severity: "expired" };
  }
  if (daysUntil <= 7) {
    return { daysUntil, severity: "critical" };
  }
  if (daysUntil <= 30) {
    return { daysUntil, severity: "warning" };
  }
  return { daysUntil, severity: "ok" };
}

/**
 * Tailwind background+text classes for a banner rendered alongside a
 * certificate expiry severity.  Keeps the color taxonomy in one place
 * — when we adjust the palette later, we only need to change it here.
 */
export function severityToBannerPalette(severity: CertExpirySeverity): string {
  switch (severity) {
    case "expired":
    case "critical":
      return "bg-red-50 text-red-800";
    case "warning":
      return "bg-amber-50 text-amber-800";
    case "ok":
      return "bg-emerald-50 text-emerald-800";
  }
}

/**
 * Tailwind fill class for a horizontal lifecycle bar reflecting the same
 * severity bucket, so the bar and the textual banner use a coherent color
 * scale.
 */
export function severityToFillClass(severity: CertExpirySeverity): string {
  switch (severity) {
    case "expired":
      return "bg-red-500";
    case "critical":
      return "bg-red-400";
    case "warning":
      return "bg-amber-400";
    case "ok":
      return "bg-emerald-500";
  }
}

/**
 * Locale-stable expiry label like `2026-04-29 (in 12d)` or
 * `2026-04-15 (expired 14d ago)`.  Drops the rest of the ISO timestamp
 * so the rendered field stays narrow without depending on the operator's
 * locale.
 */
export function formatCertificateExpiry(isoTimestamp: string, now?: number): string {
  const assessment = assessCertExpiry(isoTimestamp, now);
  if (!assessment) return isoTimestamp;
  const datePart = isoTimestamp.slice(0, 10);
  if (assessment.daysUntil < 0) {
    return `${datePart} (expired ${String(Math.abs(assessment.daysUntil))}d ago)`;
  }
  return `${datePart} (in ${String(assessment.daysUntil)}d)`;
}

/**
 * Returns a one-line copy describing what the admin should do given the
 * current expiry severity.  Returns null for the `ok` bucket — callers
 * skip the banner entirely there.
 */
export function describeCertExpiryAction(assessment: CertExpiryAssessment): string | null {
  switch (assessment.severity) {
    case "expired":
      return "Certificate expired — rotate now to keep sign-ins working.";
    case "critical":
      return `Certificate expires in ${String(assessment.daysUntil)} day${assessment.daysUntil === 1 ? "" : "s"} — rotate before users start failing sign-in.`;
    case "warning":
      return `Certificate expires in ${String(assessment.daysUntil)} days — schedule a rotation soon.`;
    case "ok":
      return null;
  }
}
