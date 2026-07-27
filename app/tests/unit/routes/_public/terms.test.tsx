// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/_public/terms", () => {
  afterEach(() => {
    cleanup();
  });

  it("serves the terms of service text at this route", async () => {
    const { Route } = await import("@/routes/_public/terms");
    const { TermsPage } = await import("@/platform/pages/terms-page");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Component = asRouteStub(Route).options.component;

    expect(Component).toBe(TermsPage);
    if (!Component) throw new Error("Expected a route component");
    render(<Component />);

    expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Acceptable use" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Do not attempt unauthorized access to Atlas systems or other user accounts.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Last updated:").parentElement).toHaveTextContent(
      "Last updated: April 23, 2026",
    );
  });

  it("publishes SEO metadata for the terms page", async () => {
    const { Route } = await import("@/routes/_public/terms");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const route = asRouteStub(Route);

    const head = route.options.head?.({}) as {
      meta: Record<string, string>[];
      links: Record<string, string>[];
    };

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Terms | Atlas" },
        {
          name: "description",
          content:
            "Terms for using Atlas public profiles, workspaces, subscriptions, and source-linked data.",
        },
        { property: "og:url", content: "https://atlas.rebuildingamerica.com/terms" },
        { name: "twitter:card", content: "summary_large_image" },
      ]),
    );
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/terms",
    });
  });
});
