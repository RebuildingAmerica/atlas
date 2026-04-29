// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/platform/ui/toast", () => ({
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

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

  it("truncates long values in the rendered input but keeps the full value in the title", () => {
    const longValue = "a".repeat(100);
    render(<WorkspaceSSOCopyField label="IdP entry point" value={longValue} truncateAt={20} />);
    const input = screen.getByDisplayValue(/^a{20}…$/);
    if (!(input instanceof HTMLInputElement)) throw new Error("expected input");
    expect(input.title).toBe(longValue);
  });

  it("renders a Copy button labelled with the field name", () => {
    render(<WorkspaceSSOCopyField label="SSO ID" value="test-id" />);
    expect(screen.getByRole("button", { name: "Copy SSO ID" })).toBeInTheDocument();
  });

  it("invokes the toast helper after a successful clipboard write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<WorkspaceSSOCopyField label="SSO ID" value="test-id" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy SSO ID" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("test-id");
    });
  });
});
