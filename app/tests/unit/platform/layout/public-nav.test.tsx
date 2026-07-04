// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicTopNav } from "@/platform/layout/public-nav";

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

    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("data-link-to", "/map");
    expect(screen.getByRole("link", { name: "Profiles" })).toHaveAttribute(
      "data-link-to",
      "/profiles",
    );
    expect(screen.getByRole("link", { name: "Browse" })).toHaveAttribute("data-link-to", "/browse");
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "data-link-to",
      "/pricing",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "data-link-to",
      "/sign-in",
    );
    expect(screen.queryByRole("link", { name: "Research" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Lists" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Watching" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Activity" })).not.toBeInTheDocument();
  });

  it("uses morphing rounded chrome that anchors after scroll", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: null,
    } as unknown as ReturnType<typeof useAtlasSession>);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });

    render(<PublicTopNav localMode={false} />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(nav).toHaveAttribute("data-chrome-state", "floating");
    expect(nav).toHaveClass("rounded-[1.25rem]");

    Object.defineProperty(window, "scrollY", { configurable: true, value: 48 });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(nav).toHaveAttribute("data-chrome-state", "anchored");
    expect(nav).toHaveClass("border-b");
  });

  it("uses the app navigation model for signed-in visitors on public pages", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: false,
        workspace: {
          activeOrganization: { id: "org_1", name: "Acme", workspaceType: "individual" },
          memberships: [{ id: "org_1", name: "Acme" }],
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
          capabilities: { canSwitchOrganizations: false },
        },
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    render(<PublicTopNav localMode={false} />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("data-link-to", "/home");
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute(
      "data-link-to",
      "/discovery",
    );
    expect(screen.getByRole("link", { name: "Coverage" })).toHaveAttribute(
      "data-link-to",
      "/coverage",
    );
    expect(screen.getByRole("link", { name: "Browse" })).toHaveAttribute("data-link-to", "/browse");
    expect(screen.getByRole("link", { name: "Lists" })).toHaveAttribute("data-link-to", "/lists");
    expect(screen.getByRole("link", { name: "Watching" })).toHaveAttribute(
      "data-link-to",
      "/watching",
    );
    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute("data-link-to", "/feed");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "data-link-to",
      "/account",
    );
    expect(screen.queryByRole("link", { name: "Pricing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Workspace" })).not.toBeInTheDocument();
  });

  it("uses core app navigation in local single-user mode without account links", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: {
        isLocal: true,
        workspace: {},
      },
    } as unknown as ReturnType<typeof useAtlasSession>);

    render(<PublicTopNav localMode />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("data-link-to", "/home");
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute(
      "data-link-to",
      "/discovery",
    );
    expect(screen.getByRole("link", { name: "Coverage" })).toHaveAttribute(
      "data-link-to",
      "/coverage",
    );
    expect(screen.getByRole("link", { name: "Browse" })).toHaveAttribute("data-link-to", "/browse");
    expect(screen.getByRole("link", { name: "Lists" })).toHaveAttribute("data-link-to", "/lists");
    expect(screen.getByRole("link", { name: "Watching" })).toHaveAttribute(
      "data-link-to",
      "/watching",
    );
    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute("data-link-to", "/feed");
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Pricing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });
});
