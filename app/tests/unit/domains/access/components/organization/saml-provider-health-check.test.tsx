// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const ssoMocks = vi.hoisted(() => ({
  checkWorkspaceSAMLProviderHealth: vi.fn(),
}));

vi.mock("@/domains/access/sso.functions", () => ({
  checkWorkspaceSAMLProviderHealth: ssoMocks.checkWorkspaceSAMLProviderHealth,
}));

import { SamlProviderHealthCheck } from "@/domains/access/components/organization/saml-provider-health-check";

describe("SamlProviderHealthCheck", () => {
  beforeEach(() => {
    ssoMocks.checkWorkspaceSAMLProviderHealth.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the disclosure summary without auto-running until opened", () => {
    render(<SamlProviderHealthCheck providerId="saml-1" />);
    expect(screen.getByText("SAML health check")).toBeInTheDocument();
    expect(ssoMocks.checkWorkspaceSAMLProviderHealth).not.toHaveBeenCalled();
  });

  it("auto-runs once when the disclosure opens and renders a healthy verdict", async () => {
    ssoMocks.checkWorkspaceSAMLProviderHealth.mockResolvedValue({
      entryPointReachable: true,
      entryPointStatus: 200,
      certificateValid: true,
      certificateExpired: false,
      certificateNotAfter: "2030-01-01",
      reason: null,
    });

    const { container } = render(<SamlProviderHealthCheck providerId="saml-1" />);
    const details = container.querySelector("details");
    if (!details) throw new Error("Expected details element");
    details.open = true;
    fireEvent(details, new Event("toggle"));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/Provider looks healthy/i);
    });
    expect(screen.getByText(/reachable \(HTTP 200\)/i)).toBeInTheDocument();
    expect(screen.getByText(/valid \(expires 2030-01-01\)/i)).toBeInTheDocument();
  });

  it("renders an unhealthy verdict when the IdP entry point is unreachable", async () => {
    ssoMocks.checkWorkspaceSAMLProviderHealth.mockResolvedValue({
      entryPointReachable: false,
      entryPointStatus: 503,
      certificateValid: true,
      certificateExpired: false,
      certificateNotAfter: "2030-01-01",
      reason: "endpoint timeout",
    });

    const { container } = render(<SamlProviderHealthCheck providerId="saml-1" />);
    const details = container.querySelector("details");
    if (!details) throw new Error("Expected details element");
    details.open = true;
    fireEvent(details, new Event("toggle"));

    await waitFor(() => {
      expect(screen.getByText(/Provider needs attention/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/unreachable \(HTTP 503\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Notes: endpoint timeout/i)).toBeInTheDocument();
  });

  it("renders an unparseable certificate result", async () => {
    ssoMocks.checkWorkspaceSAMLProviderHealth.mockResolvedValue({
      entryPointReachable: true,
      entryPointStatus: 200,
      certificateValid: false,
      certificateExpired: null,
      certificateNotAfter: null,
      reason: null,
    });

    const { container } = render(<SamlProviderHealthCheck providerId="saml-1" />);
    const details = container.querySelector("details");
    if (!details) throw new Error("Expected details element");
    details.open = true;
    fireEvent(details, new Event("toggle"));

    await waitFor(() => {
      expect(screen.getByText(/could not parse/i)).toBeInTheDocument();
    });
  });

  it("renders an expired certificate result", async () => {
    ssoMocks.checkWorkspaceSAMLProviderHealth.mockResolvedValue({
      entryPointReachable: true,
      entryPointStatus: 200,
      certificateValid: true,
      certificateExpired: true,
      certificateNotAfter: "2020-01-01",
      reason: null,
    });

    const { container } = render(<SamlProviderHealthCheck providerId="saml-1" />);
    const details = container.querySelector("details");
    if (!details) throw new Error("Expected details element");
    details.open = true;
    fireEvent(details, new Event("toggle"));

    await waitFor(() => {
      expect(screen.getByText(/expired 2020-01-01/i)).toBeInTheDocument();
    });
  });

  it("renders an unreachable IdP without a status code", async () => {
    ssoMocks.checkWorkspaceSAMLProviderHealth.mockResolvedValue({
      entryPointReachable: false,
      entryPointStatus: null,
      certificateValid: null,
      certificateExpired: null,
      certificateNotAfter: null,
      reason: null,
    });

    const { container } = render(<SamlProviderHealthCheck providerId="saml-1" />);
    const details = container.querySelector("details");
    if (!details) throw new Error("Expected details element");
    details.open = true;
    fireEvent(details, new Event("toggle"));

    await waitFor(() => {
      expect(screen.getByText(/^IdP entry point: unreachable$/)).toBeInTheDocument();
    });
    expect(screen.getByText(/^Signing certificate: unknown$/)).toBeInTheDocument();
  });

  it("re-runs the check when the operator clicks the button", async () => {
    ssoMocks.checkWorkspaceSAMLProviderHealth.mockResolvedValue({
      entryPointReachable: true,
      entryPointStatus: 200,
      certificateValid: true,
      certificateExpired: false,
      certificateNotAfter: "2030-01-01",
      reason: null,
    });

    render(<SamlProviderHealthCheck providerId="saml-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Re-run health check/i }));
    await waitFor(() => {
      expect(ssoMocks.checkWorkspaceSAMLProviderHealth).toHaveBeenCalled();
    });
  });

  it("renders an error message when the health check throws", async () => {
    ssoMocks.checkWorkspaceSAMLProviderHealth.mockRejectedValue(new Error("network down"));

    render(<SamlProviderHealthCheck providerId="saml-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Re-run health check/i }));
    await waitFor(() => {
      expect(screen.getByText(/network down/i)).toBeInTheDocument();
    });
  });

  it("falls back to a generic error when the health check rejects with a non-Error", async () => {
    ssoMocks.checkWorkspaceSAMLProviderHealth.mockRejectedValue("oops");

    render(<SamlProviderHealthCheck providerId="saml-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Re-run health check/i }));
    await waitFor(() => {
      expect(screen.getByText(/Atlas could not run the SAML health check/i)).toBeInTheDocument();
    });
  });

  it("does not auto-run a second time when the disclosure is reopened", async () => {
    ssoMocks.checkWorkspaceSAMLProviderHealth.mockResolvedValue({
      entryPointReachable: true,
      entryPointStatus: 200,
      certificateValid: true,
      certificateExpired: false,
      certificateNotAfter: "2030-01-01",
      reason: null,
    });

    const { container } = render(<SamlProviderHealthCheck providerId="saml-1" />);
    const details = container.querySelector("details");
    if (!details) throw new Error("Expected details element");
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await waitFor(() => {
      expect(ssoMocks.checkWorkspaceSAMLProviderHealth).toHaveBeenCalledTimes(1);
    });

    details.open = false;
    fireEvent(details, new Event("toggle"));
    details.open = true;
    fireEvent(details, new Event("toggle"));

    expect(ssoMocks.checkWorkspaceSAMLProviderHealth).toHaveBeenCalledTimes(1);
  });
});
