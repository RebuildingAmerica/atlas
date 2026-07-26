// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthFlowLayout } from "@/platform/layout/auth-layout";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/platform/layout/civic-map-panel", () => ({
  CivicMapPanel: () => <div data-testid="civic-map-panel" />,
}));

describe("AuthFlowLayout", () => {
  afterEach(() => {
    cleanup();
  });

  it("wraps the form surface in a main landmark", () => {
    render(
      <AuthFlowLayout>
        <form aria-label="Sign in form" />
      </AuthFlowLayout>,
    );

    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByRole("form", { name: "Sign in form" }));
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("top-aligns the auth form instead of floating it in the middle of the page", () => {
    render(
      <AuthFlowLayout>
        <form aria-label="Sign in form" />
      </AuthFlowLayout>,
    );

    const main = screen.getByRole("main");
    expect(main.className.split(/\s+/)).toContain("items-start");
    expect(main.className.split(/\s+/)).not.toContain("items-center");
  });

  it("keeps the desktop auth form column compact enough for a single-task flow", () => {
    render(
      <AuthFlowLayout>
        <form aria-label="Sign in form" />
      </AuthFlowLayout>,
    );

    const formColumn = screen.getByRole("form", { name: "Sign in form" }).parentElement;
    expect(formColumn?.className.split(/\s+/)).toContain("max-w-[30rem]");
    expect(formColumn?.className.split(/\s+/)).not.toContain("max-w-[36rem]");
  });
});
