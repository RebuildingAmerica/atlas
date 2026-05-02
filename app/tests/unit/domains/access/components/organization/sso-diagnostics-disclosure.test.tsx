// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const diagnosticsMocks = vi.hoisted(() => ({
  readSsoDiagnostics: vi.fn(),
  clearSsoDiagnostics: vi.fn(),
}));

vi.mock("@/domains/access/client/sso-diagnostics-log", () => ({
  readSsoDiagnostics: diagnosticsMocks.readSsoDiagnostics,
  clearSsoDiagnostics: diagnosticsMocks.clearSsoDiagnostics,
}));

import { SsoDiagnosticsDisclosure } from "@/domains/access/components/organization/sso-diagnostics-disclosure";

describe("SsoDiagnosticsDisclosure", () => {
  beforeEach(() => {
    diagnosticsMocks.readSsoDiagnostics.mockReset();
    diagnosticsMocks.clearSsoDiagnostics.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when there are no recorded failures", () => {
    diagnosticsMocks.readSsoDiagnostics.mockReturnValue([]);
    const { container } = render(<SsoDiagnosticsDisclosure />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the recorded failures with their codes, timestamps, emails, and messages", () => {
    diagnosticsMocks.readSsoDiagnostics.mockReturnValue([
      {
        recordedAt: "2026-04-29T10:00:00.000Z",
        code: "saml_invalid_signature",
        email: "operator@atlas.test",
        message: "IdP signature did not match the configured certificate.",
      },
      {
        recordedAt: "2026-04-29T11:00:00.000Z",
        code: null,
        email: null,
        message: null,
      },
    ]);

    render(<SsoDiagnosticsDisclosure />);
    expect(screen.getByText(/Recent SSO sign-in failures on this device/i)).toBeInTheDocument();
    expect(screen.getByText("saml_invalid_signature")).toBeInTheDocument();
    expect(screen.getByText(/operator@atlas\.test/i)).toBeInTheDocument();
    expect(
      screen.getByText("IdP signature did not match the configured certificate."),
    ).toBeInTheDocument();
    // Second entry uses the unknown-code fallback.
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("clears the log when the operator clicks Clear log", () => {
    diagnosticsMocks.readSsoDiagnostics.mockReturnValue([
      {
        recordedAt: "2026-04-29T10:00:00.000Z",
        code: "x",
        email: null,
        message: null,
      },
    ]);

    const { container } = render(<SsoDiagnosticsDisclosure />);
    fireEvent.click(screen.getByRole("button", { name: /Clear log/i }));
    expect(diagnosticsMocks.clearSsoDiagnostics).toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });
});
