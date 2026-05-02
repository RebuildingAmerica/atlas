// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  DetailSection,
  FactRail,
  FactTile,
  SurfaceBlock,
  formatGeoSpecificity,
  formatProfileLocation,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { createEntryFixture as buildEntry } from "../../../../fixtures/catalog/entries";

afterEach(() => {
  cleanup();
});

describe("formatProfileLocation", () => {
  it("returns 'city, state' when both are present", () => {
    expect(formatProfileLocation(buildEntry({ city: "Austin", state: "TX" }))).toBe("Austin, TX");
  });

  it("returns the region when city is missing but region is set", () => {
    expect(
      formatProfileLocation(buildEntry({ city: undefined, state: undefined, region: "Delta" })),
    ).toBe("Delta");
  });

  it("returns the state when only the state is available", () => {
    expect(formatProfileLocation(buildEntry({ city: undefined, region: undefined }))).toBe("MS");
  });

  it("returns a friendly fallback when no location is available", () => {
    expect(
      formatProfileLocation(buildEntry({ city: undefined, state: undefined, region: undefined })),
    ).toBe("Location not specified");
  });
});

describe("formatGeoSpecificity", () => {
  it("capitalizes the first character", () => {
    expect(formatGeoSpecificity("regional")).toBe("Regional");
    expect(formatGeoSpecificity("local")).toBe("Local");
  });
});

describe("DetailSection", () => {
  it("renders the eyebrow, title, and child content", () => {
    render(
      <DetailSection eyebrow="Section" title="Detail Title">
        <p>body</p>
      </DetailSection>,
    );
    expect(screen.getByText("Section")).toBeInTheDocument();
    expect(screen.getByText("Detail Title")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });
});

describe("SurfaceBlock", () => {
  it("renders children inside a styled section", () => {
    const { container } = render(
      <SurfaceBlock className="extra">
        <span>inner</span>
      </SurfaceBlock>,
    );
    expect(screen.getByText("inner")).toBeInTheDocument();
    expect(container.querySelector("section")?.className).toContain("extra");
  });
});

describe("FactRail", () => {
  it("renders the children grid", () => {
    render(
      <FactRail>
        <div>tile</div>
      </FactRail>,
    );
    expect(screen.getByText("tile")).toBeInTheDocument();
  });
});

describe("FactTile", () => {
  it("renders label and value", () => {
    render(<FactTile label="Sources" value={<span>4</span>} className="custom" />);
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("works without an extra className", () => {
    render(<FactTile label="State" value="MS" />);
    expect(screen.getByText("State")).toBeInTheDocument();
    expect(screen.getByText("MS")).toBeInTheDocument();
  });
});
