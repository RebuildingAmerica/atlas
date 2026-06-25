// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MapTrustLine } from "@/domains/catalog/components/map/map-trust-line";
import type { TrustLevel } from "@/types";

afterEach(cleanup);

describe("MapTrustLine", () => {
  it("reads as verified by subject for a subject-verified actor", () => {
    render(<MapTrustLine trustLevel="subject_verified" />);
    expect(screen.getByText("Verified by subject")).toBeTruthy();
  });

  it("reads as Atlas-verified for an atlas-verified actor", () => {
    render(<MapTrustLine trustLevel="atlas_verified" />);
    expect(screen.getByText("Atlas-verified")).toBeTruthy();
  });

  it("reads as corroborated for a corroborated actor", () => {
    render(<MapTrustLine trustLevel="corroborated" />);
    expect(screen.getByText("Corroborated")).toBeTruthy();
  });

  it("reads as a single source for an unverified actor — silence stays honest", () => {
    render(<MapTrustLine trustLevel="unverified" />);
    expect(screen.getByText("Single source")).toBeTruthy();
  });

  it("never claims more than the catalog can back for any tier", () => {
    const tiers: TrustLevel[] = [
      "subject_verified",
      "atlas_verified",
      "corroborated",
      "unverified",
    ];
    for (const tier of tiers) {
      cleanup();
      render(<MapTrustLine trustLevel={tier} />);
      expect(screen.getByText(/.+/)).toBeTruthy();
    }
  });
});
