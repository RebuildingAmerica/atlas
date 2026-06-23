// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkspaceUpgradeSection } from "@/domains/access/components/organization/workspace-upgrade-section";

describe("WorkspaceUpgradeSection", () => {
  const defaultProps = {
    isPending: false,
    memberCount: 3,
    onUpgrade: vi.fn(),
  };

  afterEach(() => {
    cleanup();
  });

  it("previews an accurate cost for the current member count", () => {
    render(<WorkspaceUpgradeSection {...defaultProps} />);
    // 3 members → $25 base + 2 seats × $8 = $41 per month.
    expect(screen.getByText(/Your 3 members → \$41 per month on Atlas Team/i)).toBeInTheDocument();
    expect(screen.getByText(/\$25 base \+ 2 × \$8 per month/i)).toBeInTheDocument();
  });

  it("uses singular member copy and shows no additional seats for a solo workspace", () => {
    render(<WorkspaceUpgradeSection {...defaultProps} memberCount={1} />);
    expect(screen.getByText(/Your 1 member → \$25 per month on Atlas Team/i)).toBeInTheDocument();
    expect(screen.getByText(/no additional seats yet/i)).toBeInTheDocument();
  });

  it("triggers onUpgrade when the upgrade button is clicked", () => {
    render(<WorkspaceUpgradeSection {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /Upgrade to a team workspace/i }));
    expect(defaultProps.onUpgrade).toHaveBeenCalled();
  });

  it("shows the in-flight label and disables the button while upgrading", () => {
    render(<WorkspaceUpgradeSection {...defaultProps} isPending={true} />);
    const button = screen.getByRole("button", { name: /Upgrading\.\.\./ });
    expect(button).toBeDisabled();
  });
});
