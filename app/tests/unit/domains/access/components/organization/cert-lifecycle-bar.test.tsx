// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CertLifecycleBar } from "@/domains/access/components/organization/cert-lifecycle-bar";

describe("CertLifecycleBar", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders nothing when timestamps are missing or invalid", () => {
    const { container } = render(<CertLifecycleBar notBefore={null} notAfter={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when notAfter is before notBefore", () => {
    const { container } = render(
      <CertLifecycleBar notBefore="2027-01-01T00:00:00Z" notAfter="2026-01-01T00:00:00Z" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the issued and expires labels with a percentage used", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    render(<CertLifecycleBar notBefore="2026-01-01T00:00:00Z" notAfter="2027-01-01T00:00:00Z" />);
    expect(screen.getByText(/Issued 2026-01-01/i)).toBeInTheDocument();
    expect(screen.getByText(/expires 2027-01-01/i)).toBeInTheDocument();
    expect(screen.getByText(/% of lifetime used/i)).toBeInTheDocument();
  });
});
