import {
  assessCertExpiry,
  describeCertExpiryAction,
  severityToBannerPalette,
} from "../../cert-expiry-helpers";

interface CertExpiryBannerProps {
  notAfter: string | null | undefined;
  /** Reference timestamp; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Action banner for an expiring or expired signing certificate.  Returns
 * null when the assessment is missing or the severity is `ok`, so callers
 * can render unconditionally without a wrapping check.
 */
export function CertExpiryBanner({ notAfter, now }: CertExpiryBannerProps) {
  const assessment = assessCertExpiry(notAfter, now);
  if (!assessment || assessment.severity === "ok") return null;
  const message = describeCertExpiryAction(assessment);
  if (!message) return null;
  return (
    <p
      className={`type-body-small rounded-2xl px-3 py-2 ${severityToBannerPalette(assessment.severity)}`}
      role={assessment.severity === "expired" ? "alert" : "status"}
    >
      {message}
    </p>
  );
}
