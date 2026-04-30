import { describe, expect, it } from "vitest";
import {
  assessCertExpiry,
  describeCertExpiryAction,
  formatCertificateExpiry,
  severityToBannerPalette,
  severityToFillClass,
} from "@/domains/access/cert-expiry-helpers";

describe("assessCertExpiry", () => {
  const now = new Date("2026-04-28T00:00:00Z").getTime();

  it("returns null for missing or unparseable timestamps", () => {
    expect(assessCertExpiry(null, now)).toBeNull();
    expect(assessCertExpiry(undefined, now)).toBeNull();
    expect(assessCertExpiry("not-a-date", now)).toBeNull();
  });

  it("flags expired certificates with negative daysUntil and the expired severity", () => {
    const result = assessCertExpiry("2026-04-25T00:00:00Z", now);
    expect(result?.severity).toBe("expired");
    expect(result?.daysUntil).toBeLessThan(0);
  });

  it("returns critical inside the seven-day window", () => {
    const result = assessCertExpiry("2026-05-02T00:00:00Z", now);
    expect(result?.severity).toBe("critical");
    expect(result?.daysUntil).toBe(4);
  });

  it("returns warning inside the thirty-day window", () => {
    const result = assessCertExpiry("2026-05-20T00:00:00Z", now);
    expect(result?.severity).toBe("warning");
  });

  it("returns ok beyond the thirty-day window", () => {
    const result = assessCertExpiry("2027-01-01T00:00:00Z", now);
    expect(result?.severity).toBe("ok");
  });
});

describe("severityToBannerPalette", () => {
  it("uses red for expired and critical", () => {
    expect(severityToBannerPalette("expired")).toBe("bg-red-50 text-red-800");
    expect(severityToBannerPalette("critical")).toBe("bg-red-50 text-red-800");
  });

  it("uses amber for warning and emerald for ok", () => {
    expect(severityToBannerPalette("warning")).toBe("bg-amber-50 text-amber-800");
    expect(severityToBannerPalette("ok")).toBe("bg-emerald-50 text-emerald-800");
  });
});

describe("severityToFillClass", () => {
  it("returns the configured fill for each bucket", () => {
    expect(severityToFillClass("expired")).toBe("bg-red-500");
    expect(severityToFillClass("critical")).toBe("bg-red-400");
    expect(severityToFillClass("warning")).toBe("bg-amber-400");
    expect(severityToFillClass("ok")).toBe("bg-emerald-500");
  });
});

describe("formatCertificateExpiry", () => {
  const now = new Date("2026-04-28T00:00:00Z").getTime();

  it("returns the raw value when the timestamp is unparseable", () => {
    expect(formatCertificateExpiry("not-a-date", now)).toBe("not-a-date");
  });

  it("formats expired timestamps as 'expired Nd ago'", () => {
    expect(formatCertificateExpiry("2026-04-14T00:00:00Z", now)).toBe(
      "2026-04-14 (expired 14d ago)",
    );
  });

  it("formats future timestamps as 'in Nd'", () => {
    expect(formatCertificateExpiry("2026-05-05T00:00:00Z", now)).toBe("2026-05-05 (in 7d)");
  });
});

describe("describeCertExpiryAction", () => {
  it("returns null for the ok bucket so callers skip the banner", () => {
    expect(describeCertExpiryAction({ daysUntil: 60, severity: "ok" })).toBeNull();
  });

  it("uses 'expired' copy for past certificates", () => {
    expect(describeCertExpiryAction({ daysUntil: -1, severity: "expired" })).toMatch(
      /Certificate expired/,
    );
  });

  it("singularizes the critical-bucket message at one day", () => {
    expect(describeCertExpiryAction({ daysUntil: 1, severity: "critical" })).toBe(
      "Certificate expires in 1 day — rotate before users start failing sign-in.",
    );
  });

  it("pluralizes the critical-bucket message past one day", () => {
    expect(describeCertExpiryAction({ daysUntil: 5, severity: "critical" })).toBe(
      "Certificate expires in 5 days — rotate before users start failing sign-in.",
    );
  });

  it("uses warning copy for the seven-to-thirty day window", () => {
    expect(describeCertExpiryAction({ daysUntil: 20, severity: "warning" })).toMatch(
      /schedule a rotation soon/,
    );
  });
});
