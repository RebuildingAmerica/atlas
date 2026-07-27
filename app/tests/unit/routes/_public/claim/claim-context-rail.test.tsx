// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaimContextRail } from "@/routes/_public/claim/-claim-context-rail";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("ClaimContextRail", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the place, contact facts, and a singular source count for a located profile", () => {
    render(
      <ClaimContextRail
        entry={
          {
            id: "e1",
            name: "Eastside Housing Network",
            slug: "eastside-housing-network",
            type: "organization",
            city: "Kansas City",
            state: "MO",
            region: "Midwest",
            email: "hello@eastsidehousing.org",
            website: "https://eastsidehousing.org",
            source_count: 1,
          } as Entry
        }
      />,
    );

    expect(screen.getByText("Place")).toBeInTheDocument();
    expect(screen.getByText("Kansas City, MO, Midwest")).toBeInTheDocument();
    expect(screen.getByText("1 source")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("hello@eastsidehousing.org")).toBeInTheDocument();
    expect(screen.getByText("https://eastsidehousing.org")).toBeInTheDocument();
  });

  it("falls back to the full address when the profile has no place fields", () => {
    render(
      <ClaimContextRail
        entry={
          {
            id: "e1",
            name: "Eastside Housing Network",
            slug: "eastside-housing-network",
            type: "organization",
            full_address: "1200 E 12th St, Kansas City, MO",
            source_count: 0,
          } as Entry
        }
      />,
    );

    expect(screen.getByText("1200 E 12th St, Kansas City, MO")).toBeInTheDocument();
    expect(screen.getByText("0 sources")).toBeInTheDocument();
    expect(screen.queryByText("Email")).toBeNull();
    expect(screen.queryByText("Website")).toBeNull();
  });
});
