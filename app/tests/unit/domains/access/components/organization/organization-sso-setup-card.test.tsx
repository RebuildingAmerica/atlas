// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrganizationSSOSetupCard } from "@/domains/access/components/organization/organization-sso-setup-card";

// eslint-disable-next-line atlas-tests/no-test-file-locals
type SSOOrganization = Parameters<typeof OrganizationSSOSetupCard>[0]["organization"];

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({}),
}));

describe("OrganizationSSOSetupCard", () => {
  afterEach(() => {
    cleanup();
  });

  const organization = {
    sso: {
      providers: [],
    },
  };

  it("renders empty state when no providers exist", () => {
    render(<OrganizationSSOSetupCard organization={organization as unknown as SSOOrganization} />);
    expect(screen.getByText(/No enterprise providers configured yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Once a provider is verified, mark one as primary/i),
    ).toBeInTheDocument();
  });

  it("summarizes configured and verified providers", () => {
    const orgWithProviders = {
      sso: {
        providers: [
          { providerId: "google", domainVerified: true, isPrimary: true },
          { providerId: "saml", domainVerified: false, isPrimary: false },
        ],
      },
    };
    render(
      <OrganizationSSOSetupCard organization={orgWithProviders as unknown as SSOOrganization} />,
    );
    expect(screen.getByText(/2 providers configured, 1 verified/i)).toBeInTheDocument();
    expect(screen.getByText(/Primary provider: google/i)).toBeInTheDocument();
  });

  it("shows the not-configured badge and Configure CTA when no providers exist", () => {
    render(<OrganizationSSOSetupCard organization={organization as unknown as SSOOrganization} />);
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure enterprise SSO" })).toBeInTheDocument();
  });

  it("shows the needs-verification badge when a provider exists but isn't verified", () => {
    const orgUnverified = {
      sso: {
        providers: [{ providerId: "saml_okta", domainVerified: false, isPrimary: false }],
      },
    };
    render(<OrganizationSSOSetupCard organization={orgUnverified as unknown as SSOOrganization} />);
    expect(screen.getByText("Needs domain verification")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Finish SSO setup" })).toBeInTheDocument();
  });

  it("shows the no-primary badge when verified providers exist but none is primary", () => {
    const orgVerifiedOnly = {
      sso: {
        providers: [{ providerId: "saml_okta", domainVerified: true, isPrimary: false }],
      },
    };
    render(
      <OrganizationSSOSetupCard organization={orgVerifiedOnly as unknown as SSOOrganization} />,
    );
    expect(screen.getByText("No primary provider")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose primary provider" })).toBeInTheDocument();
  });

  it("shows the active badge once a primary verified provider exists", () => {
    const orgPrimary = {
      sso: {
        providers: [{ providerId: "saml_okta", domainVerified: true, isPrimary: true }],
      },
    };
    render(<OrganizationSSOSetupCard organization={orgPrimary as unknown as SSOOrganization} />);
    expect(screen.getByText("SSO active")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage enterprise SSO" })).toBeInTheDocument();
  });
});
