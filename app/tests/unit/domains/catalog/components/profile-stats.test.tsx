// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProfileStats } from "@/domains/catalog/components/profiles/profile-stats";

describe("ProfileStats", () => {
  it("labels the panel and renders every measurement with its unit", () => {
    render(
      <ProfileStats
        items={[
          { label: "Sources", value: 12 },
          { label: "Independent", value: 4, unit: "outlets" },
          { label: "First listed", value: "2024" },
          { label: "Issue areas", value: 3 },
        ]}
      />,
    );

    expect(screen.getByRole("region", { name: "Coverage statistics" })).toBeInTheDocument();
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("outlets")).toBeInTheDocument();
    expect(screen.getByText("Issue areas")).toBeInTheDocument();
  });

  it("rules the tiles apart down the row and across the wrap", () => {
    const { container } = render(
      <ProfileStats
        items={[
          { label: "One", value: 1 },
          { label: "Two", value: 2 },
          { label: "Three", value: 3 },
        ]}
      />,
    );

    const tiles = Array.from(container.querySelectorAll("section > div"));
    expect(tiles).toHaveLength(3);
    // The leading tile carries no divider; later tiles gain a left rule, and
    // the third wraps onto a second row so it gains a top rule too.
    expect(tiles[0]?.className).not.toContain("sm:border-l");
    expect(tiles[1]?.className).toContain("sm:border-l");
    expect(tiles[1]?.className).not.toContain("border-t-border-taupe");
    expect(tiles[2]?.className).toContain("border-t-border-taupe");
  });
});
