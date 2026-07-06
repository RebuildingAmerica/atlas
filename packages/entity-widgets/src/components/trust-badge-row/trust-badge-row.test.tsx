import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TrustBadgeRow } from "./trust-badge-row";

afterEach(() => {
  cleanup();
});

describe("TrustBadgeRow", () => {
  it("renders a checkmark-prefixed label for atlas_verified", () => {
    render(
      <TrustBadgeRow verificationLevel="atlas_verified" sourceCount={3} />,
    );
    expect(screen.getByText("✓ Atlas-verified")).toBeInTheDocument();
    expect(screen.getByText("3 sources")).toBeInTheDocument();
  });

  it("renders a checkmark-prefixed label for the hyphenated atlas-verified spelling", () => {
    render(
      <TrustBadgeRow verificationLevel="atlas-verified" sourceCount={2} />,
    );
    expect(screen.getByText("✓ Atlas-verified")).toBeInTheDocument();
  });

  it("renders a checkmark-prefixed label for subject_verified", () => {
    render(
      <TrustBadgeRow verificationLevel="subject_verified" sourceCount={5} />,
    );
    expect(screen.getByText("✓ Subject-verified")).toBeInTheDocument();
  });

  it("renders a checkmark-prefixed label for the hyphenated subject-verified spelling", () => {
    render(
      <TrustBadgeRow verificationLevel="subject-verified" sourceCount={5} />,
    );
    expect(screen.getByText("✓ Subject-verified")).toBeInTheDocument();
  });

  it("renders an un-prefixed label for corroborated", () => {
    render(<TrustBadgeRow verificationLevel="corroborated" sourceCount={2} />);
    expect(screen.getByText("Corroborated")).toBeInTheDocument();
  });

  it("renders an un-prefixed label for source-derived", () => {
    render(
      <TrustBadgeRow verificationLevel="source-derived" sourceCount={1} />,
    );
    expect(screen.getByText("Source-derived")).toBeInTheDocument();
  });

  it("renders an un-prefixed label for unverified", () => {
    render(<TrustBadgeRow verificationLevel="unverified" sourceCount={0} />);
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText("0 sources")).toBeInTheDocument();
  });

  it("humanizes an unrecognized verification level instead of showing the raw string", () => {
    render(
      <TrustBadgeRow verificationLevel="pending_review" sourceCount={1} />,
    );
    expect(screen.getByText("Pending Review")).toBeInTheDocument();
  });

  it("uses singular 'source' for a count of exactly one", () => {
    render(<TrustBadgeRow verificationLevel="unverified" sourceCount={1} />);
    expect(screen.getByText("1 source")).toBeInTheDocument();
  });
});
