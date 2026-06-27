// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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

  it("uses the same morphing rounded chrome as the public shell", () => {
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
    expect(nav).toHaveAttribute("data-chrome-state", "floating");
    expect(nav).toHaveClass("rounded-[1.25rem]");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("data-link-to", "/home");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();

    Object.defineProperty(window, "scrollY", { configurable: true, value: 48 });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(nav).toHaveAttribute("data-chrome-state", "anchored");
    expect(nav).toHaveClass("border-b");
  });
});
