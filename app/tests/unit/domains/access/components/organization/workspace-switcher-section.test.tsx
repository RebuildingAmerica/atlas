// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkspaceSwitcherSection } from "@/domains/access/components/organization/workspace-switcher-section";

describe("WorkspaceSwitcherSection", () => {
  const memberships = [
    { id: "org_1", name: "Atlas Team", workspaceType: "team" },
    { id: "org_2", name: "Personal", workspaceType: "individual" },
  ];

  const defaultProps = {
    isPending: false,
    memberships,
    selectedOrganizationId: "org_1",
    onChange: vi.fn(),
  };

  afterEach(() => {
    cleanup();
  });

  it("renders the switcher with memberships", () => {
    render(<WorkspaceSwitcherSection {...defaultProps} />);
    expect(screen.getByText(/2 workspaces/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("org_1");
  });

  it("triggers onChange when a new workspace is selected", () => {
    render(<WorkspaceSwitcherSection {...defaultProps} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "org_2" } });
    expect(defaultProps.onChange).toHaveBeenCalledWith("org_2");
  });

  it("disables the select during pending state", () => {
    render(<WorkspaceSwitcherSection {...defaultProps} isPending={true} />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
