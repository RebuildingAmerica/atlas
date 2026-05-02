// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OAuthWorkspacePicker } from "@/domains/access/pages/auth/components/oauth-workspace-picker";
import { createAtlasWorkspaceMembership } from "../../../../../../fixtures/access/sessions";

afterEach(() => {
  cleanup();
});

describe("OAuthWorkspacePicker", () => {
  it("renders nothing when the operator has no memberships", () => {
    const { container } = render(
      <OAuthWorkspacePicker memberships={[]} selectedWorkspaceId={null} onSelect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a static line when the operator has exactly one membership", () => {
    render(
      <OAuthWorkspacePicker
        memberships={[createAtlasWorkspaceMembership({ name: "Solo" })]}
        selectedWorkspaceId="org_a"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Solo")).not.toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("renders a radio list and forwards selection to onSelect when there are multiple memberships", () => {
    const onSelect = vi.fn();
    const memberships = [
      createAtlasWorkspaceMembership({ id: "org_a", name: "Atlas Team" }),
      createAtlasWorkspaceMembership({ id: "org_b", name: "Atlas Research", role: "admin" }),
    ];
    render(
      <OAuthWorkspacePicker
        memberships={memberships}
        selectedWorkspaceId="org_a"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Atlas Team")).not.toBeNull();
    expect(screen.getByText("Atlas Research")).not.toBeNull();

    fireEvent.click(screen.getByLabelText(/Atlas Research/));
    expect(onSelect).toHaveBeenCalledWith("org_b");
  });
});
