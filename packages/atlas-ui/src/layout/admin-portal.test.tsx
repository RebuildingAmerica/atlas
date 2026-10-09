import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AdminIndicatorCard,
  AdminIndicatorPlaceholderCard,
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
  type AdminIndicatorTone,
} from "./admin-portal";

const TONES: AdminIndicatorTone[] = ["pass", "warn", "block", "neutral"];

describe("admin portal chrome", () => {
  afterEach(() => {
    cleanup();
  });

  it("frames a page with its badge, title, description and actions", () => {
    render(
      <AdminPageShell>
        <AdminPageHeader badge="Platform" title="Discounts" description="Review requests.">
          <button type="button">Refresh</button>
        </AdminPageHeader>
      </AdminPageShell>,
    );

    expect(screen.getByRole("heading", { name: "Discounts" })).toBeTruthy();
    expect(screen.getByText("Platform")).toBeTruthy();
    expect(screen.getByText("Review requests.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it.each(TONES)("shows a %s indicator and badge", (tone) => {
    const { container } = render(
      <>
        <AdminIndicatorCard label="Spend" value="$3" detail="Today" tone={tone} />
        <AdminStatusBadge tone={tone} compact>
          {tone}
        </AdminStatusBadge>
      </>,
    );

    expect(screen.getByText("$3")).toBeTruthy();
    expect(screen.getByText(tone).className).toContain("px-2 py-0.5");
    expect(container.querySelector("[aria-hidden]")).toBeTruthy();
  });

  it("shows a dash while an indicator has no value", () => {
    render(<AdminIndicatorPlaceholderCard label="Billing export" detail="Not connected" />);

    expect(screen.getByText("-")).toBeTruthy();
  });

  it("announces a status message and renders nothing without one", () => {
    const { container, rerender } = render(<AdminInlineStatus />);
    expect(container.textContent).toBe("");

    rerender(<AdminInlineStatus message="Saved." />);
    expect(screen.getByText("Saved.").getAttribute("aria-live")).toBe("polite");
  });
});
