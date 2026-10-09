// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SwitchesView } from "@/domains/switches/switches-view";
import { platformSwitches } from "../fixtures/admin";
import { reasonBox } from "../helpers/switches";

describe("SwitchesView", () => {
  it("shows each switch, what it does now and its last change", () => {
    render(
      <SwitchesView
        isLoading={false}
        onChange={vi.fn()}
        switches={platformSwitches()}
      />,
    );

    expect(screen.getByText("Released")).toBeInTheDocument();
    expect(screen.getByText("Engaged")).toBeInTheDocument();
    expect(screen.getByText("Never changed.")).toBeInTheDocument();
    expect(
      screen.getByText(
        /by willie@rebuildingus.org: Stripe is double-charging./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Existing subscriptions keep working/),
    ).toBeInTheDocument();
    expect(screen.getByText(/spend within their daily/)).toBeInTheDocument();
  });

  it("flips a switch only with a reason, and clears it once the switch changes", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SwitchesView
        isLoading={false}
        onChange={onChange}
        switches={platformSwitches()}
      />,
    );
    const stop = screen.getByRole("button", { name: "Stop discovery spend" });
    expect(stop).toBeDisabled();

    await userEvent.type(reasonBox(0), " Runaway search bill ");
    await userEvent.click(stop);
    await userEvent.type(reasonBox(1), "Stripe fixed it");
    await userEvent.click(screen.getByRole("button", { name: "Reopen sales" }));

    expect(onChange).toHaveBeenNthCalledWith(1, {
      engaged: true,
      name: "discovery_spend",
      reason: "Runaway search bill",
    });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      engaged: false,
      name: "checkout",
      reason: "Stripe fixed it",
    });
    // Kept until the switch really changes, so a cancelled change loses nothing.
    expect(reasonBox(0)).toHaveValue(" Runaway search bill ");
    rerender(
      <SwitchesView
        isLoading={false}
        onChange={onChange}
        switches={platformSwitches().map((item) =>
          item.name === "discovery_spend"
            ? { ...item, changed_at: "2026-10-09T19:00:00Z", engaged: true }
            : item,
        )}
      />,
    );
    expect(reasonBox(0)).toHaveValue("");
  });

  it("holds a switch while it changes, and shows loading and errors", () => {
    const { rerender } = render(
      <SwitchesView
        isLoading={false}
        onChange={vi.fn()}
        pendingName="checkout"
        switches={platformSwitches()}
      />,
    );
    expect(reasonBox(1)).toBeDisabled();

    rerender(
      <SwitchesView
        changeMessage="The switch could not be changed."
        errorMessage="Switches could not load."
        isLoading
        onChange={vi.fn()}
        switches={[]}
      />,
    );
    expect(document.querySelector("[aria-busy]")).not.toBeNull();
    expect(screen.getByText("Switches could not load.")).toBeInTheDocument();
    expect(
      screen.getByText("The switch could not be changed."),
    ).toBeInTheDocument();
  });
});
