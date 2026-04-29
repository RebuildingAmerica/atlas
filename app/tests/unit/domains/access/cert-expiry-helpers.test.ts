import { describe, expect, it } from "vitest";
import { assessCertExpiry } from "@/domains/access/cert-expiry-helpers";

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
