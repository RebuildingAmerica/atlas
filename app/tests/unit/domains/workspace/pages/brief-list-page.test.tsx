// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BriefListPage } from "@/domains/workspace/pages/brief-list-page";
import type { AtlasBriefCollection } from "@/domains/workspace/server/briefs";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("BriefListPage", () => {
  afterEach(() => {
    cleanup();
  });

  function briefCollection(): AtlasBriefCollection {
    return {
      total: 1,
      items: [
        {
          id: "brief_123",
          org_id: "org_123",
          title: "Tenant Power in Kansas City",
          scope: {
            geography: "Kansas City, MO",
            issue_areas: ["housing_affordability"],
            actor_types: ["organization"],
            source_types: ["news"],
          },
          summary: "A source-linked brief for tenant organizing.",
          linked_entry_ids: ["entry_1", "entry_2"],
          linked_source_ids: ["source_1"],
          linked_discovery_run_ids: ["run_1"],
          confidence_summary: {
            source_count: 1,
            state: "partial",
            review_status: "reviewed",
          },
          gaps: [],
          created_by: "operator_1",
          created_at: "2026-07-03T10:00:00.000Z",
          updated_at: "2026-07-03T11:00:00.000Z",
        },
      ],
    };
  }

  it("renders brief history with links, scope, and provenance counts", () => {
    render(<BriefListPage briefCollection={briefCollection()} />);

    expect(screen.getByRole("heading", { name: "Atlas Briefs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New brief" })).toHaveAttribute(
      "data-link-to",
      "/briefs/new",
    );
    expect(screen.getByRole("link", { name: /Tenant Power in Kansas City/ })).toHaveAttribute(
      "data-link-to",
      "/briefs/$briefId",
    );
    expect(screen.getByText("Kansas City, MO")).toBeInTheDocument();
    expect(screen.getByText("housing affordability")).toBeInTheDocument();
    expect(screen.getByText("2 actors")).toBeInTheDocument();
    expect(screen.getByText("1 source")).toBeInTheDocument();
    expect(screen.getByText("reviewed")).toBeInTheDocument();
  });

  it("renders a plain empty state", () => {
    render(<BriefListPage briefCollection={{ items: [], total: 0 }} />);

    expect(screen.getByText("No briefs yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New brief" })).toHaveAttribute(
      "data-link-to",
      "/briefs/new",
    );
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute(
      "data-link-to",
      "/discovery",
    );
  });
});
