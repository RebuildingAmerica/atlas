// @vitest-environment jsdom

import "./profile-redesign-test-setup";

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileHistory } from "@/domains/catalog/components/profiles/profile-history";
import {
  createEntryFixture as buildEntry,
  createSourceFixture as buildSource,
} from "../../../../fixtures/catalog/entries";

describe("ProfileHistory", () => {
  it("shows the public record timeline from existing profile evidence", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          first_seen: "2024-01-15T00:00:00Z",
          latest_source_date: "2026-04-12",
          updated_at: "2026-04-20T00:00:00Z",
          claim: {
            status: "verified",
            verification_level: "subject-verified",
            claim_verified_at: "2026-03-10T00:00:00Z",
          },
          sources: [
            buildSource({
              title: "Tenant hotline expands",
              publication: "Mississippi Today",
              published_date: "2026-04-12",
            }),
            buildSource({
              title: "Earlier profile",
              publication: "Jackson Free Press",
              published_date: "2025-11-02",
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText("Record history")).toBeInTheDocument();
    expect(screen.getByText("First listed")).toBeInTheDocument();
    expect(screen.getByText(/Jan 2024/)).toBeInTheDocument();
    expect(screen.getByText("Latest source")).toBeInTheDocument();
    expect(screen.getByText(/Mississippi Today/)).toBeInTheDocument();
    expect(screen.getByText("Subject verified")).toBeInTheDocument();
    expect(screen.getByText("Representation updated")).toBeInTheDocument();
  });

  it("shows an audit trail for corrections, verification, and representation changes", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          slug: "jane-doe-a3f2",
          first_seen: "2024-01-15T00:00:00Z",
          created_at: "2024-01-15T00:00:00Z",
          updated_at: "2026-04-20T00:00:00Z",
          claim: {
            status: "pending",
            verification_level: "source-derived",
          },
        })}
      />,
    );

    expect(screen.getByText("Audit trail")).toBeInTheDocument();
    expect(screen.getByText("Correction review")).toBeInTheDocument();
    const correctionLink = screen.getByRole("link", { name: "Send a correction" });
    expect(correctionLink).toHaveAttribute("href", "/feedback/$slug");
    expect(correctionLink).toHaveAttribute(
      "data-link-params",
      JSON.stringify({ slug: "jane-doe-a3f2" }),
    );
    expect(screen.getByText("Verification review")).toBeInTheDocument();
    expect(screen.getByText("Representation claim awaiting review.")).toBeInTheDocument();
    expect(screen.getByText("Representation changes")).toBeInTheDocument();
    expect(screen.getByText("Public profile fields changed Apr 2026.")).toBeInTheDocument();
  });

  it("uses an honest history state when dated source and verification evidence is absent", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          first_seen: "2024-01-15T00:00:00Z",
          latest_source_date: undefined,
          last_seen: "2024-01-15T00:00:00Z",
          updated_at: "2024-01-15T00:00:00Z",
          sources: [],
          claim: { status: "unclaimed", verification_level: "source-derived" },
        })}
      />,
    );

    expect(screen.getByText("No dated source updates.")).toBeInTheDocument();
    expect(screen.queryByText(/still gathering/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pipeline/i)).not.toBeInTheDocument();
  });
});
