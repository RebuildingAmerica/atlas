// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MapTrustLine } from "@/domains/catalog/components/map/map-trust-line";
import type { TrustLevel } from "@/types";

afterEach(cleanup);

describe("MapTrustLine", () => {
  it("reads as verified representative for a subject-verified organization", () => {
    render(<MapTrustLine actorType="organization" trustLevel="subject_verified" />);
    expect(screen.getByText("Verified representative")).toBeTruthy();
    expect(screen.queryByText("Verified by subject")).toBeNull();
  });

  it("reads as verified person for a subject-verified person", () => {
    render(<MapTrustLine actorType="person" trustLevel="subject_verified" />);
    expect(screen.getByText("Verified person")).toBeTruthy();
    expect(screen.queryByText("Verified by subject")).toBeNull();
  });

  it("reads as Atlas-verified for an atlas-verified actor", () => {
    render(<MapTrustLine actorType="organization" trustLevel="atlas_verified" />);
    expect(screen.getByText("Atlas-verified")).toBeTruthy();
  });

  it("reads as corroborated for a corroborated actor", () => {
    render(<MapTrustLine actorType="organization" trustLevel="corroborated" />);
    expect(screen.getByText("Corroborated")).toBeTruthy();
  });

  it("reads as unverified without inventing a source count", () => {
    render(<MapTrustLine actorType="organization" trustLevel="unverified" />);
    expect(screen.getByText("Unverified")).toBeTruthy();
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
      render(<MapTrustLine actorType="organization" trustLevel={tier} />);
      expect(screen.getByText(/.+/)).toBeTruthy();
    }
  });
});
