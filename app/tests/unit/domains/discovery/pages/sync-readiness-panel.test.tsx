// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createCompletedResearchRunFixture } from "@rebuildingamerica/atlas-catalog/testing/discovery";
import { SyncReadinessPanel } from "@/domains/discovery/pages/components/sync-readiness-panel";

describe("SyncReadinessPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("summarizes CRM and newsroom handoff readiness for source-backed leads", () => {
    render(<SyncReadinessPanel run={createCompletedResearchRunFixture()} />);

    expect(screen.getByRole("region", { name: "Sync readiness" })).toBeInTheDocument();
    expect(screen.getByText("Sync readiness")).toBeInTheDocument();
    expect(screen.getByText("Ready for CRM or newsroom handoff")).toBeInTheDocument();
    expect(screen.getByText("1 lead with source context")).toBeInTheDocument();
    expect(screen.getByText("1 key source attached")).toBeInTheDocument();
    expect(screen.getByText("CSV, JSON, and brief exports available")).toBeInTheDocument();
  });

  it("renders nothing before a run has structured research output", () => {
    const { container } = render(
      <SyncReadinessPanel
        run={createCompletedResearchRunFixture({ research_summary: undefined })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
