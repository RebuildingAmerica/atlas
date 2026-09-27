// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicTopNav, PublicTopNavSafe } from "@/platform/layout/public-nav";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access", () => ({
  useAtlasSession: vi.fn(),
}));

describe("PublicTopNav", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps public navigation public-only for signed-out visitors", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: null,
    } as unknown as ReturnType<typeof useAtlasSession>);

    render(<PublicTopNav localMode={false} />);

    expect(screen.getByRole("searchbox", { name: "Search Atlas" })).toBeInTheDocument();
    const primaryNavigation = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(primaryNavigation).getByRole("link", { name: "Explore" })).toHaveAttribute(
      "data-link-to",
      "/browse",
    );
    expect(within(primaryNavigation).queryByRole("link", { name: "Firehose" })).toBeNull();
    expect(within(primaryNavigation).queryByRole("link", { name: "Docs" })).toBeNull();
    expect(screen.getByRole("button", { name: "More navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "data-link-to",
      "/sign-in",
    );
    expect(screen.queryByRole("link", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Profiles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Research" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Lists" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Watching" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Activity" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More navigation" }));
    const menu = screen.getByRole("navigation", { name: "Public navigation menu" });
    expect(within(menu).getByRole("link", { name: "Explore" })).toHaveAttribute(
      "data-link-to",
      "/browse",
    );
    expect(within(menu).getByRole("link", { name: "Map" })).toHaveAttribute("data-link-to", "/map");
    expect(within(menu).getByRole("link", { name: "People" })).toHaveAttribute(
      "data-link-to",
      "/profiles/people",
    );
    expect(within(menu).getByRole("link", { name: "Organizations" })).toHaveAttribute(
      "data-link-to",
      "/profiles/organizations",
    );
    expect(within(menu).getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "data-link-to",
      "/pricing",
    );
    expect(within(menu).getByRole("link", { name: "Firehose" })).toHaveAttribute(
      "data-link-to",
      "/firehose",
    );
    expect(within(menu).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    expect(within(menu).getByRole("link", { name: "API" })).toHaveAttribute("href", "/docs/api");
  });

  it("lets the home page own search instead of duplicating it in chrome", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: null,
    } as unknown as ReturnType<typeof useAtlasSession>);

    render(<PublicTopNav localMode={false} showSearch={false} />);

    expect(screen.queryByRole("searchbox", { name: "Search Atlas" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("searchbox", { name: "Search Atlas on mobile" }),
    ).not.toBeInTheDocument();
  });

  it("keeps account-specific saved work out of the safe error-page header", () => {
    render(<PublicTopNavSafe />);

    expect(screen.getByRole("link", { name: "Explore" })).toHaveAttribute(
      "data-link-to",
      "/browse",
    );
    expect(screen.queryByRole("link", { name: "Saved" })).not.toBeInTheDocument();
  });

  it("keeps secondary destinations in an operable More menu after the brand", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: null,
    } as unknown as ReturnType<typeof useAtlasSession>);

    render(<PublicTopNav localMode={false} />);

    const primaryNavigation = screen.getByRole("navigation", { name: "Primary navigation" });
    const brandLink = primaryNavigation.querySelector('[data-link-to="/"]');
    const menuButton = within(primaryNavigation).getByRole("button", {
      name: "More navigation",
    });

    expect(brandLink).toBeInTheDocument();
    if (brandLink == null) {
      throw new Error("Expected the Atlas brand link to render in primary navigation.");
    }
    expect(brandLink.compareDocumentPosition(menuButton)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(menuButton).toHaveAttribute("data-menu-state", "closed");
    expect(within(menuButton).getByTestId("public-menu-icon-top")).toHaveAttribute(
      "data-icon-state",
      "closed",
    );

    fireEvent.click(menuButton);

    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    expect(menuButton).toHaveAttribute("data-menu-state", "open");
    expect(within(menuButton).getByTestId("public-menu-icon-top")).toHaveAttribute(
      "data-icon-state",
      "open",
    );
  });

  it("lets signed-out public chrome float before anchoring on scroll", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: null,
    } as unknown as ReturnType<typeof useAtlasSession>);
    render(<PublicTopNav localMode={false} />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(nav).toHaveAttribute("data-chrome-frame", "showcase");
    expect(nav).toHaveClass("flex-nowrap");
    expect(nav).toHaveClass("atlas-top-bar-showcase");
  });

  it("keeps signed-in public pages discovery-first instead of rendering the app nav in the top bar", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: false,
        user: {
          email: "admin@example.com",
          emailVerified: true,
          id: "user_1",
          image: "https://example.com/avatar.png",
          name: "Admin",
        },
        workspace: {
          activeOrganization: { id: "org_1", name: "Acme", workspaceType: "individual" },
          memberships: [{ id: "org_1", name: "Acme" }],
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: false },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    render(<PublicTopNav localMode={false} />);

    expect(screen.getByRole("link", { name: "Workbench" })).toHaveAttribute(
      "data-link-to",
      "/home",
    );
    expect(screen.getByRole("link", { name: "Explore" })).toHaveAttribute(
      "data-link-to",
      "/browse",
    );
    expect(screen.getByRole("link", { name: "Saved" })).toHaveAttribute("data-link-to", "/lists");
    expect(screen.queryByRole("link", { name: "Your organization" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Research" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Coverage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Watching" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More navigation" }));
    const menu = screen.getByRole("navigation", { name: "Public navigation menu" });
    expect(within(menu).getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "data-link-to",
      "/pricing",
    );
    expect(within(menu).getByRole("link", { name: "API" })).toHaveAttribute("href", "/docs/api");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("keeps local single-user mode compact while linking into the workbench", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: true,
        workspace: {},
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    render(<PublicTopNav localMode />);

    expect(screen.getByRole("link", { name: "Workbench" })).toHaveAttribute(
      "data-link-to",
      "/home",
    );
    expect(screen.getByRole("link", { name: "Explore" })).toHaveAttribute(
      "data-link-to",
      "/browse",
    );
    expect(screen.getByRole("link", { name: "Saved" })).toHaveAttribute("data-link-to", "/lists");
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Research" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Coverage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Watching" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More navigation" }));
    const menu = screen.getByRole("navigation", { name: "Public navigation menu" });
    expect(within(menu).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    expect(within(menu).getByRole("link", { name: "API" })).toHaveAttribute("href", "/docs/api");
    expect(within(menu).getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "data-link-to",
      "/pricing",
    );
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("gives a team member direct access to saved work and their organization", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: false,
        user: {
          email: "member@example.com",
          emailVerified: true,
          id: "user_3",
          image: null,
          name: "Member",
        },
        workspace: {
          activeOrganization: { id: "org_3", name: "Transit Team", workspaceType: "team" },
          memberships: [{ id: "org_3", name: "Transit Team" }],
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: false },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    render(<PublicTopNav localMode={false} />);

    expect(screen.getByRole("link", { name: "Saved" })).toHaveAttribute("data-link-to", "/lists");
    expect(screen.getByRole("link", { name: "Your organization" })).toHaveAttribute(
      "data-link-to",
      "/organization",
    );

    fireEvent.click(screen.getByRole("button", { name: "More navigation" }));
    const menu = screen.getByRole("navigation", { name: "Public navigation menu" });
    expect(within(menu).getByRole("link", { name: "Saved" })).toHaveAttribute(
      "data-link-to",
      "/lists",
    );
    expect(within(menu).getByRole("link", { name: "Your organization" })).toHaveAttribute(
      "data-link-to",
      "/organization",
    );
  });

  it("falls back to the person glyph when a signed-in visitor has no avatar", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: false,
        user: {
          email: "operator@example.com",
          emailVerified: true,
          id: "user_2",
          image: null,
          name: "Operator",
        },
        workspace: {
          activeOrganization: { id: "org_1", name: "Acme", workspaceType: "individual" },
          memberships: [{ id: "org_1", name: "Acme" }],
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: false },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    render(<PublicTopNav localMode={false} />);

    const workbenchChip = screen.getByRole("link", { name: "Workbench" });
    expect(workbenchChip).toHaveAttribute("data-link-to", "/home");
    expect(workbenchChip.querySelector("img")).toBeNull();
  });
});
