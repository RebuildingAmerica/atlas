// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrganizationTeamWorkspaceRequiredState } from "@/domains/access/components/organization/organization-team-workspace-required-state";

describe("OrganizationTeamWorkspaceRequiredState", () => {
  it("renders the team requirement message", () => {
    render(<OrganizationTeamWorkspaceRequiredState />);
    expect(
      screen.getByText(/Enterprise SSO is available only for team workspaces/i),
    ).toBeInTheDocument();
  });
});
