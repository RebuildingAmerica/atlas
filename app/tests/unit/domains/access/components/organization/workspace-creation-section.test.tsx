// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const slugMocks = vi.hoisted(() => ({
  checkWorkspaceSlugAvailability: vi.fn(),
}));

vi.mock("@/domains/access/organizations.functions", () => ({
  checkWorkspaceSlugAvailability: slugMocks.checkWorkspaceSlugAvailability,
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

  beforeEach(() => {
    slugMocks.checkWorkspaceSlugAvailability.mockReset();
    slugMocks.checkWorkspaceSlugAvailability.mockResolvedValue({ available: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it("hides the email-domain and handoff fields when the workspace shape is individual", () => {
    render(<WorkspaceCreationSection {...defaultProps} workspaceType="individual" />);
    expect(screen.queryByLabelText(/Email domain/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Setting this up for someone else/)).not.toBeInTheDocument();
  });

  it("renders the available state once the debounced check resolves", async () => {
    slugMocks.checkWorkspaceSlugAvailability.mockResolvedValue({ available: true });
    render(<WorkspaceCreationSection {...defaultProps} />);
    expect(screen.getByText(/Checking availability/i)).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText(/Slug is available/i)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("renders the taken state and disables submit when the slug is in use", async () => {
    slugMocks.checkWorkspaceSlugAvailability.mockResolvedValue({ available: false });
    render(<WorkspaceCreationSection {...defaultProps} />);
    await waitFor(
      () => {
        expect(screen.getByText(/Slug is already taken/i)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.getByText(/Create workspace/i)).toBeDisabled();
  });

  it("falls back to idle when the availability call rejects", async () => {
    slugMocks.checkWorkspaceSlugAvailability.mockRejectedValue(new Error("boom"));
    render(<WorkspaceCreationSection {...defaultProps} />);
    await waitFor(
      () => {
        expect(slugMocks.checkWorkspaceSlugAvailability).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    expect(screen.queryByText(/Slug is already taken/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Slug is available/i)).not.toBeInTheDocument();
  });

  it("treats a slug shorter than three characters as idle and skips the API call", () => {
    render(<WorkspaceCreationSection {...defaultProps} workspaceSlug="ab" />);
    expect(screen.queryByText(/Checking availability/i)).not.toBeInTheDocument();
    expect(slugMocks.checkWorkspaceSlugAvailability).not.toHaveBeenCalled();
  });

  it("opens the handoff section by default when a delegated email is pre-filled", () => {
    render(
      <WorkspaceCreationSection {...defaultProps} workspaceDelegatedEmail="admin@acme.example" />,
    );
    expect(screen.getByLabelText(/Future admin email/i)).toBeVisible();
  });

  it("forwards delegated email and domain edits to the parent handlers", () => {
    render(
      <WorkspaceCreationSection {...defaultProps} workspaceDelegatedEmail="admin@acme.example" />,
    );
    fireEvent.change(screen.getByLabelText(/Email domain/i), {
      target: { value: "acme.example" },
    });
    expect(defaultProps.onDomainChange).toHaveBeenCalledWith("acme.example");

    fireEvent.change(screen.getByLabelText(/Future admin email/i), {
      target: { value: "owner@acme.example" },
    });
    expect(defaultProps.onDelegatedEmailChange).toHaveBeenCalledWith("owner@acme.example");
  });

  it("toggles the handoff disclosure open and closed", () => {
    render(<WorkspaceCreationSection {...defaultProps} workspaceDelegatedEmail="" />);
    const summary = screen.getByText(/Setting this up for someone else/);
    const details = summary.closest("details");
    if (!details) throw new Error("Expected details element");
    expect(details.open).toBe(false);
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(details.open).toBe(true);
  });

  it("ignores the slug-availability response if the slug changes before the request resolves", async () => {
    let resolveCheck: ((value: { available: boolean }) => void) | null = null;
    slugMocks.checkWorkspaceSlugAvailability.mockImplementation(
      () =>
        new Promise<{ available: boolean }>((resolve) => {
          resolveCheck = resolve;
        }),
    );

    const { rerender } = render(<WorkspaceCreationSection {...defaultProps} />);
    await waitFor(
      () => {
        expect(slugMocks.checkWorkspaceSlugAvailability).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    // Change the slug, which cancels the in-flight check.
    rerender(<WorkspaceCreationSection {...defaultProps} workspaceSlug="atlas-2" />);

    if (resolveCheck) {
      await act(async () => {
        (resolveCheck as (value: { available: boolean }) => void)({ available: true });
        await Promise.resolve();
      });
    }
    // The first slug's "available" verdict should not apply — the new slug is
    // still in the checking state.
    expect(screen.getByText(/Checking availability/i)).toBeInTheDocument();
  });

  it("ignores the slug-availability rejection if the slug changes before the request settles", async () => {
    let rejectCheck: ((reason: Error) => void) | null = null;
    slugMocks.checkWorkspaceSlugAvailability.mockImplementation(
      () =>
        new Promise<{ available: boolean }>((_, reject) => {
          rejectCheck = reject;
        }),
    );

    const { rerender } = render(<WorkspaceCreationSection {...defaultProps} />);
    await waitFor(
      () => {
        expect(slugMocks.checkWorkspaceSlugAvailability).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    rerender(<WorkspaceCreationSection {...defaultProps} workspaceSlug="atlas-2" />);

    if (rejectCheck) {
      await act(async () => {
        (rejectCheck as (reason: Error) => void)(new Error("late rejection"));
        await Promise.resolve();
      });
    }
    expect(screen.getByText(/Checking availability/i)).toBeInTheDocument();
  });
});
