// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/../tests/helpers/render-with-providers";
import { stubFetch } from "@/../tests/helpers/stub-fetch";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/_workspace/admin/profile-claims", () => {
  beforeEach(() => {
    stubFetch(() => ({
      body: {
        items: [
          {
            created_at: "2026-07-07T12:00:00Z",
            entry_id: "entry_1",
            entry_name: "Mississippi Rising",
            entry_slug: "mississippi-rising",
            evidence: { relationship: "communications director" },
            id: "claim_1",
            proofs: [],
            status: "pending",
            tier: 2,
            updated_at: "2026-07-07T12:00:00Z",
            user_email: "operator@example.org",
            user_id: "user_1",
          },
        ],
        total: 1,
      },
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("puts the claim review queue behind the workspace admin route", async () => {
    const routeModule = await import("@/routes/_workspace/admin/profile-claims");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    renderWithProviders(<Component />);

    expect(await screen.findByText("Mississippi Rising")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve Mississippi Rising" })).toBeInTheDocument();
  });
});
