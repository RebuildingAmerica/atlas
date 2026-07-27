// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/_public/privacy", () => {
  afterEach(() => {
    cleanup();
  });

  it("serves the privacy policy text at this route", async () => {
    const { Route } = await import("@/routes/_public/privacy");
    const { PrivacyPage } = await import("@/platform/pages/privacy-page");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Component = asRouteStub(Route).options.component;

    expect(Component).toBe(PrivacyPage);
    if (!Component) throw new Error("Expected a route component");
    render(<Component />);

    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Public-source data in Atlas" }),
    ).toBeInTheDocument();
    expect(screen.getByText("To process billing and administer subscriptions")).toBeInTheDocument();
    expect(screen.getByText("Last updated:").parentElement).toHaveTextContent(
      "Last updated: April 23, 2026",
    );
  });

  it("publishes SEO metadata for the privacy page", async () => {
    const { Route } = await import("@/routes/_public/privacy");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const route = asRouteStub(Route);

    const head = route.options.head?.({}) as {
      meta: Record<string, string>[];
      links: Record<string, string>[];
    };

    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Privacy | Atlas" },
        {
          name: "description",
          content: "How Atlas handles account, billing, usage, and public-source civic data.",
        },
        { property: "og:url", content: "https://atlas.rebuildingamerica.com/privacy" },
        { name: "twitter:card", content: "summary_large_image" },
      ]),
    );
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/privacy",
    });
  });
});
