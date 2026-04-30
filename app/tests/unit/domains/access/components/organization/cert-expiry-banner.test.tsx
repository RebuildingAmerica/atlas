// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CertExpiryBanner } from "@/domains/access/components/organization/cert-expiry-banner";

describe("CertExpiryBanner", () => {
  const now = new Date("2026-04-28T00:00:00Z").getTime();

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when notAfter is missing", () => {
    const { container } = render(<CertExpiryBanner notAfter={null} now={now} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the certificate is comfortably in the future", () => {
    const { container } = render(<CertExpiryBanner notAfter="2027-04-28T00:00:00Z" now={now} />);
    expect(container.firstChild).toBeNull();
  });

  it("uses role=alert for expired certificates", () => {
    render(<CertExpiryBanner notAfter="2026-04-14T00:00:00Z" now={now} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Certificate expired/);
  });

  it("uses role=status for expiring soon", () => {
    render(<CertExpiryBanner notAfter="2026-05-02T00:00:00Z" now={now} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/Certificate expires/);
  });
});
