import { assessCertExpiry, severityToFillClass } from "../../cert-expiry-helpers";

interface CertLifecycleBarProps {
  notAfter: string | null | undefined;
  notBefore: string | null | undefined;
  /**
   * Reference timestamp; defaults to `Date.now()`.  Pass a single shared
   * `now` from the parent map iteration to keep all per-provider Date.now
   * reads in sync within the same render.
   */
  now?: number;
}

/**
 * Horizontal lifecycle bar showing where the current time sits between a
 * certificate's `notBefore` and `notAfter` boundaries.  Provides a visual
 * analogue to the textual "expires in N days" copy and makes Atlas's cert
 * calendar legible without a separate calendar surface.
 */
export function CertLifecycleBar({ notAfter, notBefore, now: nowProp }: CertLifecycleBarProps) {
  const start = notBefore ? new Date(notBefore).getTime() : NaN;
  const end = notAfter ? new Date(notAfter).getTime() : NaN;
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return null;
  }
  const now = nowProp ?? Date.now();
  const elapsed = Math.min(Math.max(0, now - start), end - start);
  const pct = Math.round((elapsed / (end - start)) * 100);
  const assessment = assessCertExpiry(notAfter ?? null, now);
  const fillClass = assessment ? severityToFillClass(assessment.severity) : "bg-emerald-500";

  return (
    <div className="space-y-1" aria-label="Certificate lifecycle">
      <div className="bg-surface-container-low h-2 w-full overflow-hidden rounded-full">
        <div className={`h-full ${fillClass}`} style={{ width: `${String(pct)}%` }} />
      </div>
      <p className="type-body-small text-outline">
        Issued {new Date(start).toISOString().slice(0, 10)} · expires{" "}
        {new Date(end).toISOString().slice(0, 10)} · {String(pct)}% of lifetime used
      </p>
    </div>
  );
}
