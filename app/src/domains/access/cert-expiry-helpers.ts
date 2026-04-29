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
