// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDirectoryConfigSection } from "@/domains/access/components/organization/workspace-directory-config-section";

describe("WorkspaceDirectoryConfigSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders directory settings and submits normalized scope values", () => {
    const onSubmit = vi.fn();

    render(
      <WorkspaceDirectoryConfigSection
        canManageOrganization
        directoryConfigPending={false}
        directoryTitle="Detroit tenant power directory"
        directorySponsorLabel="Supported by Detroit Housing Fund"
        directoryIssueAreaIds="housing_affordability, tenant_power"
        directoryGeographyLabels="Detroit, MI"
        directoryEntryTypes="organization"
        directoryMethodologySummary="Reviewed records with linked public sources."
        directorySourcePolicy="Every listing includes a public source."
        directoryReviewPolicy="Records are checked before publication."
        directoryCorrectionPolicy="Readers can send corrections."
        onDirectoryCorrectionPolicyChange={vi.fn()}
        onDirectoryEntryTypesChange={vi.fn()}
        onDirectoryGeographyLabelsChange={vi.fn()}
        onDirectoryIssueAreaIdsChange={vi.fn()}
        onDirectoryMethodologySummaryChange={vi.fn()}
        onDirectoryReviewPolicyChange={vi.fn()}
        onDirectorySourcePolicyChange={vi.fn()}
        onDirectorySponsorLabelChange={vi.fn()}
        onDirectoryTitleChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("heading", { name: "Public directory" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Detroit tenant power directory")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Supported by Detroit Housing Fund")).toBeInTheDocument();
    expect(screen.getByDisplayValue("housing_affordability, tenant_power")).toBeInTheDocument();

    fireEvent.submit(screen.getByRole("button", { name: "Save directory settings" }));

    expect(onSubmit).toHaveBeenCalled();
  });

  it("renders read-only values for operators who cannot manage the workspace", () => {
    render(
      <WorkspaceDirectoryConfigSection
        canManageOrganization={false}
        directoryConfigPending={false}
        directoryTitle="Detroit tenant power directory"
        directorySponsorLabel=""
        directoryIssueAreaIds="housing_affordability"
        directoryGeographyLabels="Detroit, MI"
        directoryEntryTypes="organization"
        directoryMethodologySummary="Reviewed records with linked public sources."
        directorySourcePolicy="Every listing includes a public source."
        directoryReviewPolicy="Records are checked before publication."
        directoryCorrectionPolicy="Readers can send corrections."
        onDirectoryCorrectionPolicyChange={vi.fn()}
        onDirectoryEntryTypesChange={vi.fn()}
        onDirectoryGeographyLabelsChange={vi.fn()}
        onDirectoryIssueAreaIdsChange={vi.fn()}
        onDirectoryMethodologySummaryChange={vi.fn()}
        onDirectoryReviewPolicyChange={vi.fn()}
        onDirectorySourcePolicyChange={vi.fn()}
        onDirectorySponsorLabelChange={vi.fn()}
        onDirectoryTitleChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Detroit tenant power directory")).toBeInTheDocument();
    expect(screen.getByText("housing_affordability")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save directory settings" }),
    ).not.toBeInTheDocument();
  });
});
