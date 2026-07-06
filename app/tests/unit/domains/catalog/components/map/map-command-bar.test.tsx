// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { makePoint } from "../../../../../helpers/catalog/map-clustering-harness";
import { renderCommandBar } from "../../../../../helpers/catalog/map-command-bar-harness";
import type { PlaceMatch } from "@/domains/catalog/map/map-place-search";
import type { MapPoint } from "@/types";

vi.mock("@headlessui/react", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverButton: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  PopoverPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

describe("MapCommandBar", () => {
  it("keeps the result menu closed until the visitor types", () => {
    renderCommandBar();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("suggests places and actors as the visitor types, in labeled groups", () => {
    renderCommandBar(undefined, [makePoint({ id: "1", name: "Dallas Housing Trust" })]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Dallas" } });

    expect(screen.getByRole("group", { name: "Places" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Actors" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Dallas, TX/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Dallas Housing Trust/ })).toBeTruthy();
  });

  it("flies to a place and sets its filter when a place option is chosen", () => {
    const onSelectPlace = vi.fn<(place: PlaceMatch) => void>();
    renderCommandBar({ onSelectPlace });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Dallas" } });
    fireEvent.click(screen.getByRole("option", { name: /Dallas, TX/ }));

    expect(onSelectPlace).toHaveBeenCalledOnce();
    expect(onSelectPlace.mock.calls[0]?.[0].label).toBe("Dallas, TX");
  });

  it("flies to and opens an actor when an actor option is chosen", () => {
    const onSelectActor = vi.fn<(point: MapPoint) => void>();
    const point = makePoint({ id: "1", name: "Dallas Housing Trust" });
    renderCommandBar({ onSelectActor }, [point]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Dallas" } });
    fireEvent.click(screen.getByRole("option", { name: /Dallas Housing Trust/ }));

    expect(onSelectActor).toHaveBeenCalledWith(point);
  });

  it("clears the query and closes the menu after a selection", () => {
    const point = makePoint({ id: "1", name: "Dallas Housing Trust" });
    renderCommandBar(undefined, [point]);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Dallas" } });
    fireEvent.click(screen.getByRole("option", { name: /Dallas Housing Trust/ }));

    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("explains a no-match query rather than showing an empty menu", () => {
    renderCommandBar(undefined, []);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "zzzznowhere" } });

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("No places or actors match");
    expect(input.getAttribute("aria-describedby")).toBe(status.id);
    expect(input.getAttribute("aria-controls")).toBeNull();
  });

  it("toggles an issue filter through the disclosure", () => {
    const onToggleFilter = vi.fn();
    renderCommandBar({ onToggleFilter });
    fireEvent.click(screen.getByRole("button", { name: "Housing" }));
    expect(onToggleFilter).toHaveBeenCalledWith("issue_areas", "housing-affordability");
  });

  it("toggles a type filter through the disclosure", () => {
    const onToggleFilter = vi.fn();
    renderCommandBar({ onToggleFilter });
    fireEvent.click(screen.getByRole("button", { name: "People" }));
    expect(onToggleFilter).toHaveBeenCalledWith("entry_types", "person");
  });

  it("toggles a source filter through the disclosure", () => {
    const onToggleFilter = vi.fn();
    renderCommandBar({ onToggleFilter });
    fireEvent.click(screen.getByRole("button", { name: "Local news" }));
    expect(onToggleFilter).toHaveBeenCalledWith("source_types", "news_article");
  });

  it("hides the Types disclosure when entry-type filtering is turned off", () => {
    renderCommandBar(undefined, undefined, { showEntryTypeFilter: false });
    expect(screen.queryByText("Types")).toBeNull();
    // Issues and Sources still anchor the filter row.
    expect(screen.getByText("Issues")).toBeTruthy();
    expect(screen.getByText("Sources")).toBeTruthy();
  });

  it("closes an open menu when Escape is pressed", () => {
    renderCommandBar(undefined, [makePoint({ id: "1", name: "Dallas Housing Trust" })]);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Dallas" } });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps the menu open on a non-Escape keypress", () => {
    renderCommandBar(undefined, [makePoint({ id: "1", name: "Dallas Housing Trust" })]);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Dallas" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("tracks and selects the active combobox option from the keyboard", () => {
    const onSelectPlace = vi.fn<(place: PlaceMatch) => void>();
    renderCommandBar({ onSelectPlace }, [makePoint({ id: "1", name: "Dallas Housing Trust" })]);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "Dallas" } });
    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });

    const option = screen.getByRole("option", { name: /Dallas, TX/ });
    expect(option.id).not.toBe("");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(option.tagName).toBe("LI");
    expect(option.getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelectPlace).toHaveBeenCalledOnce();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows only the Actors group when nothing matches a place", () => {
    renderCommandBar(undefined, [makePoint({ id: "1", name: "Zephyr Collective" })]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Zephyr" } });
    expect(screen.getByRole("group", { name: "Actors" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Places" })).toBeNull();
  });

  it("shows only the Places group when no actor matches", () => {
    renderCommandBar(undefined, []);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Dallas" } });
    expect(screen.getByRole("group", { name: "Places" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Actors" })).toBeNull();
  });
});
