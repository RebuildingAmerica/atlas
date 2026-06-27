// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";
import { BrowseEcosystemHistorySection } from "@/domains/catalog/components/browse/browse-ecosystem-history-section";

describe("BrowseEcosystemHistorySection", () => {
  afterEach(() => {
    cleanup();
  });

  it("summarizes dated actor and source history for a place-plus-issue landscape", () => {
    render(
      <BrowseEcosystemHistorySection
        entries={[
          createEntryFixture({
            id: "entry_1",
            type: "organization",
            first_seen: "2023-02-10T00:00:00Z",
            last_seen: "2026-04-12T00:00:00Z",
            latest_source_date: "2026-04-12",
            source_count: 4,
          }),
          createEntryFixture({
            id: "entry_2",
            type: "person",
            first_seen: "2024-06-01T00:00:00Z",
            last_seen: "2025-11-09T00:00:00Z",
            latest_source_date: "2025-11-09",
            source_count: 2,
          }),
          createEntryFixture({
            id: "entry_3",
            type: "initiative",
            first_seen: "2025-03-20T00:00:00Z",
            last_seen: "2026-02-18T00:00:00Z",
            latest_source_date: "2026-02-18",
            source_count: 1,
          }),
        ]}
        issueLabel="Housing Affordability"
        placeLabel="Missouri"
        total={12}
      />,
    );

    expect(screen.getByRole("region", { name: "Ecosystem history" })).not.toBeNull();
    expect(screen.getByText("Missouri Housing Affordability history")).not.toBeNull();
    expect(screen.getByText("Feb 2023 - Apr 2026")).not.toBeNull();
    expect(screen.getByText("Latest activity Apr 2026")).not.toBeNull();
    expect(screen.getByText("7 linked sources across 3 dated records.")).not.toBeNull();
    expect(screen.getByText("Organizations lead the visible actor mix.")).not.toBeNull();
  });

  it("renders nothing when the landscape has no dated entries", () => {
    const { container } = render(
      <BrowseEcosystemHistorySection
        entries={[
          createEntryFixture({
            first_seen: "",
            last_seen: "",
            latest_source_date: undefined,
          }),
        ]}
        issueLabel={undefined}
        placeLabel={undefined}
        total={1}
      />,
    );

    expect(container.innerHTML).toBe("");
  });
});
