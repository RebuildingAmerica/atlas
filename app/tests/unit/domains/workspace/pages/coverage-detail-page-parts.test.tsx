// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatStableDateTime } from "@rebuildingamerica/atlas-ui/format/date-time";
import {
  countLabel,
  formatCadence,
  formatDateTime,
  joined,
  profileLinkForEntry,
  SourceTargetRow,
  stateFromGeography,
} from "@/domains/workspace/pages/coverage-detail-page-parts";
import type { CoverageTargetDetail } from "@/domains/workspace/server/coverage-targets";
import type { WorkspaceFirehoseSourceTarget } from "@/domains/workspace/server/firehose";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("coverage detail page parts", () => {
  function sourceTarget(
    overrides: Partial<WorkspaceFirehoseSourceTarget> = {},
  ): WorkspaceFirehoseSourceTarget {
    return {
      cadence_seconds: 60,
      content_hash: null,
      coverage_target_id: "coverage_123",
      created_at: "2026-07-07T16:00:00Z",
      created_by: "operator_1",
      enabled: true,
      etag: null,
      id: "source_target_123",
      issues: ["housing_affordability"],
      label: "Kansas City housing agenda",
      last_checked_at: null,
      last_error: null,
      last_http_status: null,
      last_modified: null,
      last_success_at: null,
      org_id: "org_123",
      origin: "api",
      origin_note: null,
      places: ["kansas-city-mo"],
      priority: "hot",
      public_route_enabled: true,
      safety_policy: "standard",
      source_class: "government_agenda",
      source_kind: "rss",
      updated_at: "2026-07-07T16:00:00Z",
      url: "https://example.test/kc-agenda.xml",
      ...overrides,
    };
  }

  function entry(
    overrides: Partial<CoverageTargetDetail["entries"][number]>,
  ): CoverageTargetDetail["entries"][number] {
    return {
      city: "Kansas City",
      id: "entry_123",
      name: "KC Tenants",
      slug: "kc-tenants",
      source_count: 1,
      sources: [],
      state: "MO",
      type: "organization",
      ...overrides,
    };
  }

  it("counts with the singular the reader expects and an explicit plural", () => {
    expect(countLabel(1, "record")).toBe("1 record");
    expect(countLabel(0, "record")).toBe("0 records");
    expect(countLabel(3, "entity", { plural: "entities" })).toBe("3 entities");
  });

  it("says nothing is listed rather than showing an empty line", () => {
    expect(joined([])).toBe("None listed");
    expect(joined(["housing_affordability", "civic-trust"])).toBe(
      "housing affordability, civic trust",
    );
  });

  it("explains why a poll time is missing instead of printing a bad date", () => {
    expect(formatDateTime(formatStableDateTime, null)).toBe("Not checked");
    expect(formatDateTime(formatStableDateTime, "not-a-date")).toBe("Unknown");
    expect(formatDateTime(formatStableDateTime, "2026-07-07T16:00:00Z")).toBe(
      "Jul 7, 2026, 4:00 PM",
    );
  });

  it("scales the polling cadence to the unit a reader can hold in their head", () => {
    expect(formatCadence(45)).toBe("45s");
    expect(formatCadence(119)).toBe("119s");
    expect(formatCadence(300)).toBe("5m");
    expect(formatCadence(7200)).toBe("2h");
  });

  it("reads the state off a geography only when one is written there", () => {
    expect(stateFromGeography("Kansas City, mo")).toBe("MO");
    expect(stateFromGeography("Kansas City")).toBe("");
  });

  it("links only the actor kinds that have a public profile page", () => {
    expect(profileLinkForEntry(entry({ type: "organization" }))).toEqual({
      params: { slug: "kc-tenants" },
      to: "/profiles/organizations/$slug",
    });
    expect(profileLinkForEntry(entry({ slug: "ada-ruiz", type: "person" }))).toEqual({
      params: { slug: "ada-ruiz" },
      to: "/profiles/people/$slug",
    });
    expect(profileLinkForEntry(entry({ type: "initiative" }))).toBeNull();
    expect(profileLinkForEntry(entry({ slug: null }))).toBeNull();
  });

  it("shows a healthy public source with its cadence and link", () => {
    render(<SourceTargetRow target={sourceTarget()} />);

    expect(screen.getByRole("link", { name: /Kansas City housing agenda/ })).toHaveAttribute(
      "href",
      "https://example.test/kc-agenda.xml",
    );
    expect(screen.getByText("government agenda | RSS | 60s")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Public route")).toBeInTheDocument();
    expect(screen.getByText("Not checked")).toBeInTheDocument();
    expect(screen.queryByText(/^HTTP /)).not.toBeInTheDocument();
  });

  it("surfaces the failure a paused, private source last hit", () => {
    render(
      <SourceTargetRow
        target={sourceTarget({
          enabled: false,
          last_checked_at: "2026-07-07T16:00:00Z",
          last_error: "Feed returned no items.",
          last_http_status: 503,
          public_route_enabled: false,
        })}
      />,
    );

    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.queryByText("Public route")).not.toBeInTheDocument();
    expect(screen.getByText("Jul 7, 2026, 4:00 PM")).toBeInTheDocument();
    expect(screen.getByText("HTTP 503")).toBeInTheDocument();
    expect(screen.getByText("Feed returned no items.")).toBeInTheDocument();
  });
});
