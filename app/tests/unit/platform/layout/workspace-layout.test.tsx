// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLayout } from "@/platform/layout/workspace-layout";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("WorkspaceLayout", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders primary chrome and a separate workbench rail", () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });

    render(
      <WorkspaceLayout
        tabs={[
          { label: "Home", to: "/home" },
          { label: "Research", to: "/discovery" },
          { label: "Browse", to: "/browse" },
        ]}
        identitySlot={<button type="button">Sign out</button>}
      >
        <p>Workspace content</p>
      </WorkspaceLayout>,
    );

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(nav).toHaveAttribute("data-chrome-frame", "app");
    expect(screen.getByRole("searchbox", { name: "Search Atlas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();

    const rail = screen.getByRole("navigation", { name: "Workbench navigation" });
    expect(rail).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("data-link-to", "/home");
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute(
      "data-link-to",
      "/discovery",
    );
    expect(screen.getByRole("link", { name: "Browse" })).toHaveAttribute("data-link-to", "/browse");
  });

  it("offers the workbench destinations from compact chrome", () => {
    render(
      <WorkspaceLayout
        tabs={[
          { label: "Home", to: "/home" },
          { label: "Research", to: "/discovery" },
        ]}
      >
        <p>Workspace content</p>
      </WorkspaceLayout>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open workbench navigation menu" }));

    const menu = screen.getByRole("navigation", { name: "Workbench menu" });
    expect(within(menu).getByRole("link", { name: "Home" })).toHaveAttribute(
      "data-link-to",
      "/home",
    );
    expect(within(menu).getByRole("link", { name: "Research" })).toHaveAttribute(
      "data-link-to",
      "/discovery",
    );
  });
});
