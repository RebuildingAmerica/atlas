// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowSections } from "@/routes/_workspace/lists/list-detail-page-workflow";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("routes/_workspace/lists workflow sections", () => {
  afterEach(() => {
    cleanup();
  });

  it("still names a next step for the newsroom when the thread has no follow-ups", () => {
    const noop = vi.fn();

    render(
      <WorkflowSections
        completedFollowUps={[]}
        crmPacketText="{}"
        evidencePack="Tenant power map evidence pack"
        institutionalExport="name,type"
        isTeamWorkspace={false}
        newsroomAssignmentPacket="Assignment packet"
        nonprofitSystemsPacket="Systems packet"
        onCopyCrmPacket={noop}
        onCopyEvidencePack={noop}
        onCopyInstitutionalExport={noop}
        onCopyNewsroomPacket={noop}
        onCopyNonprofitSystemsPacket={noop}
        onCopySpreadsheetExport={noop}
        onDownloadCrmPacket={noop}
        onDownloadInstitutionalExport={noop}
        onDownloadSavedListExport={noop}
        onDownloadSpreadsheetExport={noop}
        onToggleFollowUp={noop}
        researchThread={{ actorCount: 0, followUps: [], noteCount: 0, sourceCount: 0 }}
        workspaceName="You"
      />,
    );

    expect(screen.getByText("Next: Review lead")).toBeInTheDocument();
    expect(screen.getByText("Follow-up context")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
