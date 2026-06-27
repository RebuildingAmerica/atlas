// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { RolePermissionsGuide } from "@/domains/access/components/organization/role-permissions-guide";

describe("RolePermissionsGuide", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders access levels as a compact table", () => {
    render(<RolePermissionsGuide />);

    const guide = screen.getByRole("region", { name: "Role guide" });
    const table = within(guide).getByRole("table", { name: "Role permissions" });

    expect(within(table).getByText("Owner")).toBeInTheDocument();
    expect(
      within(table).getByText("Workspace settings, billing, members, and shared research."),
    ).toBeInTheDocument();
    expect(within(table).getByText("Admin")).toBeInTheDocument();
    expect(
      within(table).getByText("Members, invitations, and shared research."),
    ).toBeInTheDocument();
    expect(within(table).getByText("Member")).toBeInTheDocument();
    expect(within(table).getByText("Shared research, notes, and exports.")).toBeInTheDocument();
  });
});
