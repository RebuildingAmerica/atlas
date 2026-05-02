// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SaveButtonWithMissingFields } from "@/domains/access/components/organization/workspace-sso-save-button";

describe("SaveButtonWithMissingFields", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the idle label and is enabled when nothing is missing", () => {
    render(
      <SaveButtonWithMissingFields
        isPending={false}
        label="Save"
        missing={[]}
        pendingLabel="Saving..."
      />,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveAttribute("title");
  });

  it("disables and lists every missing field on hover", () => {
    render(
      <SaveButtonWithMissingFields
        isPending={false}
        label="Save"
        missing={["entry point", "certificate"]}
        pendingLabel="Saving..."
      />,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Missing: entry point, certificate");
  });

  it("renders the pending label and clears the missing-fields tooltip while saving", () => {
    render(
      <SaveButtonWithMissingFields
        isPending={true}
        label="Save"
        missing={["entry point"]}
        pendingLabel="Saving..."
      />,
    );
    const button = screen.getByRole("button", { name: "Saving..." });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("title");
  });
});
