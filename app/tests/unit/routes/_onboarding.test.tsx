// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/_onboarding layout", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the setup shell out of search results", async () => {
    const routeModule = await import("@/routes/_onboarding");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const head = asRouteStub(routeModule.Route).options.head?.({}) as {
      meta: { content?: string; name?: string; title?: string }[];
    };

    expect(head.meta).toEqual([
      { title: "Set up Atlas" },
      { name: "description", content: "Set up your Atlas workspace." },
      { name: "robots", content: "noindex,nofollow" },
    ]);
  });

  it("wraps each setup step with a way home and the legal links", async () => {
    const routeModule = await import("@/routes/_onboarding");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    render(<Component />);

    expect(screen.getByRole("link", { name: "Atlas" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    expect(screen.getByTestId("router-outlet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByRole("link", { name: "Terms of service" })).toHaveAttribute(
      "href",
      "/terms",
    );
  });
});
