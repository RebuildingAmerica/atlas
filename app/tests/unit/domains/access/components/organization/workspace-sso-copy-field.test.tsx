// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkspaceSSOCopyField } from "@/domains/access/components/organization/workspace-sso-copy-field";

describe("WorkspaceSSOCopyField", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders a single-line input by default", () => {
    render(<WorkspaceSSOCopyField label="SSO ID" value="test-id" />);
    expect(screen.getByText("SSO ID")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test-id")).toBeInTheDocument();
    expect(screen.getByDisplayValue("test-id").tagName).toBe("INPUT");
  });

  it("renders a textarea when multiline is true", () => {
    render(<WorkspaceSSOCopyField label="Cert" value="---BEGIN---" multiline={true} />);
    expect(screen.getByDisplayValue("---BEGIN---").tagName).toBe("TEXTAREA");
  });

  it("selects all text on focus", () => {
    render(<WorkspaceSSOCopyField label="SSO ID" value="test-id" />);
    const input = screen.getByDisplayValue("test-id");
    const selectSpy = vi.spyOn(input as HTMLInputElement, "select");

    fireEvent.focus(input);
    expect(selectSpy).toHaveBeenCalled();
  });
});
