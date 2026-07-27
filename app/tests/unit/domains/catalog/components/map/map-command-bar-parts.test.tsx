// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tags } from "lucide-react";
import { MapFilterPanel } from "@/domains/catalog/components/map/map-command-bar-parts";

afterEach(cleanup);

describe("MapFilterPanel", () => {
  it("renders an option that carries no icon without leaving a gap in its label", () => {
    const onClick = vi.fn();
    const setOpenFilter = vi.fn();

    render(
      <MapFilterPanel
        menu={{
          count: 0,
          icon: Tags,
          items: [{ active: false, key: "housing", label: "Housing", onClick }],
          key: "issues",
          label: "Issues",
        }}
        setOpenFilter={setOpenFilter}
      />,
    );

    const group = screen.getByRole("group", { name: "Issues" });
    const option = screen.getByRole("button", { name: "Housing" });
    expect(group).toContainElement(option);
    expect(option.querySelector("svg")).toBeNull();

    fireEvent.click(option);
    expect(onClick).toHaveBeenCalledOnce();
    expect(setOpenFilter).toHaveBeenCalledWith(null);
  });
});
