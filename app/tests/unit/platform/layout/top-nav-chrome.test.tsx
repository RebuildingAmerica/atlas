// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("TopNavChrome", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("routes in-app destinations through the router and external ones as plain links", async () => {
    const { TopNavChrome } = await import("@/platform/layout/top-nav-chrome");

    render(
      <TopNavChrome
        items={[
          { label: "Browse", to: "/browse" },
          { label: "Docs", native: true, to: "/docs" },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Browse" })).toHaveAttribute("data-link-to", "/browse");
    const docs = screen.getByRole("link", { name: "Docs" });
    expect(docs).toHaveAttribute("href", "/docs");
    expect(docs).not.toHaveAttribute("data-link-to");
  });

  it("always offers the brand mark and a search box", async () => {
    const { TopNavChrome } = await import("@/platform/layout/top-nav-chrome");

    render(<TopNavChrome />);

    expect(screen.getByRole("link", { name: "A Atlas" })).toHaveAttribute("data-link-to", "/");
    expect(screen.getByRole("search")).toHaveAttribute("action", "/browse");
    expect(screen.getByRole("searchbox", { name: "Search Atlas" })).toHaveAttribute(
      "name",
      "query",
    );
  });

  it("leaves the trailing slot out when there is neither a menu nor an identity", async () => {
    const { TopNavChrome } = await import("@/platform/layout/top-nav-chrome");

    render(<TopNavChrome />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(nav).queryByTestId("workspace-identity")).toBeNull();
    expect(nav.querySelector(".ml-auto")).toBeNull();
  });

  it("groups the menu and identity slots together at the trailing edge", async () => {
    const { TopNavChrome } = await import("@/platform/layout/top-nav-chrome");

    render(
      <TopNavChrome
        identitySlot={<span data-testid="workspace-identity">Tenant KC</span>}
        rightSlot={<button type="button">Menu</button>}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    const trailing = nav.querySelector(".ml-auto");
    expect(trailing).not.toBeNull();
    expect(within(trailing as HTMLElement).getByRole("button", { name: "Menu" })).toBeVisible();
    expect(within(trailing as HTMLElement).getByTestId("workspace-identity")).toHaveTextContent(
      "Tenant KC",
    );
  });
});
