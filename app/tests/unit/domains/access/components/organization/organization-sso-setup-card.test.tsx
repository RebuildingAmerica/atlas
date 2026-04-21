// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrganizationSSOSetupCard } from "@/domains/access/components/organization/organization-sso-setup-card";

type SSOOrganization = Parameters<typeof OrganizationSSOSetupCard>[0]["organization"];

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({}),
}));

describe("OrganizationSSOSetupCard", () => {
  const organization = {
    sso: {
      providers: [],
    },
  };

  it("renders empty state when no providers exist", () => {
    render(<OrganizationSSOSetupCard organization={organization as unknown as SSOOrganization} />);
    expect(screen.getByText(/No enterprise providers configured yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No primary provider selected yet/i)).toBeInTheDocument();
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
});
