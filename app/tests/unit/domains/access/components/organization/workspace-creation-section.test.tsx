// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/domains/access/organizations.functions", () => ({
  checkWorkspaceSlugAvailability: vi.fn().mockResolvedValue({ available: true }),
}));

import { WorkspaceCreationSection } from "@/domains/access/components/organization/workspace-creation-section";

describe("WorkspaceCreationSection", () => {
  const defaultProps = {
    isPending: false,
    workspaceDelegatedEmail: "",
    workspaceDomain: "",
    workspaceName: "Atlas",
    workspaceSlug: "atlas",
    workspaceType: "team" as const,
    onDelegatedEmailChange: vi.fn(),
    onDomainChange: vi.fn(),
    onNameChange: vi.fn(),
    onSlugChange: vi.fn(),
    onSubmit: vi.fn((e: { preventDefault: () => void }) => {
      e.preventDefault();
    }),
    onWorkspaceTypeChange: vi.fn(),
  };

  afterEach(() => {
    cleanup();
  });

  it("renders the form with provided values", () => {
    render(<WorkspaceCreationSection {...defaultProps} />);

    expect(screen.getByLabelText(/Workspace name/i)).toHaveValue("Atlas");
    expect(screen.getByLabelText(/Workspace slug/i)).toHaveValue("atlas");
    expect(screen.getByText(/Create workspace/i)).toBeInTheDocument();
  });

  it("calls handlers on input change", () => {
    render(<WorkspaceCreationSection {...defaultProps} />);

    fireEvent.change(screen.getByLabelText(/Workspace name/i), { target: { value: "New Team" } });
    expect(defaultProps.onNameChange).toHaveBeenCalledWith("New Team");

    fireEvent.change(screen.getByLabelText(/Workspace slug/i), { target: { value: "new-team" } });
    expect(defaultProps.onSlugChange).toHaveBeenCalledWith("new-team");

    fireEvent.click(screen.getByRole("radio", { name: /Individual workspace/i }));
    expect(defaultProps.onWorkspaceTypeChange).toHaveBeenCalledWith("individual");
  });

  it("disables the submit button when inputs are whitespace", () => {
    render(<WorkspaceCreationSection {...defaultProps} workspaceName="   " workspaceSlug="   " />);
    expect(screen.getByText(/Create workspace/i)).toBeDisabled();
  });

  it("disables the submit button when inputs are empty", () => {
    render(<WorkspaceCreationSection {...defaultProps} workspaceName="" workspaceSlug="" />);
    expect(screen.getByText(/Create workspace/i)).toBeDisabled();
  });

  it("disables the submit button and shows loading state when pending", () => {
    render(<WorkspaceCreationSection {...defaultProps} isPending={true} />);
    expect(screen.getByText(/Creating.../i)).toBeDisabled();
  });

  it("triggers onSubmit when form is submitted", () => {
    render(<WorkspaceCreationSection {...defaultProps} />);
    const button = screen.getByText(/Create workspace/i);
    const form = button.closest("form");
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);
    expect(defaultProps.onSubmit).toHaveBeenCalled();
  });
});
