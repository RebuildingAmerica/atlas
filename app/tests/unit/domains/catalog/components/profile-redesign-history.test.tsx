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
    expect(correctionLink).toHaveAttribute("href", "/feedback/jane-doe-a3f2");
    expect(correctionLink).toHaveAttribute(
      "data-link-params",
      JSON.stringify({ slug: "jane-doe-a3f2" }),
    );
    expect(screen.getByText("Verification review")).toBeInTheDocument();
    expect(screen.getByText("Representation verification under review.")).toBeInTheDocument();
    expect(screen.getByText("Representation changes")).toBeInTheDocument();
    expect(screen.getByText("Profile details changed Apr 2026.")).toBeInTheDocument();
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

  it("says a date is undated rather than printing a broken one", () => {
    render(<ProfileHistory entry={buildEntry({ first_seen: "unknown" })} />);
    expect(screen.getByText("Undated")).toBeInTheDocument();
  });

  it("dates a source packet from ingestion when the publisher gave no date", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          sources: [
            buildSource({
              ingested_at: "2026-06-15T00:00:00Z",
              publication: undefined,
              published_date: undefined,
              title: "Hotline expands",
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText("Latest source")).toBeInTheDocument();
    expect(screen.getByText("Hotline expands")).toBeInTheDocument();
    expect(screen.getByText(/Jun 2026/)).toBeInTheDocument();
  });

  it("falls back to a generic packet label when a source is untitled", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          sources: [buildSource({ publication: undefined, title: undefined })],
        })}
      />,
    );
    expect(screen.getByText("Source packet")).toBeInTheDocument();
  });

  it("records an Atlas review when nobody claimed the profile", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          claim: { status: "unclaimed", verification_level: "atlas-verified" },
          last_verified: "2026-03-02T00:00:00Z",
          trust: {
            level: "atlas_verified",
            independent_source_count: null,
            website_grounded: null,
            email_grounded: null,
          },
        })}
      />,
    );

    expect(screen.getByText("Atlas-verified")).toBeInTheDocument();
    expect(screen.getByText("Profile facts reviewed against public evidence.")).toBeInTheDocument();
    expect(screen.getByText("Public evidence reviewed Mar 2026.")).toBeInTheDocument();
  });

  it("reports no changes when the record has not moved since it was listed", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
        })}
      />,
    );

    expect(screen.queryByText("Representation updated")).not.toBeInTheDocument();
    expect(screen.getByText("No profile detail changes since listing.")).toBeInTheDocument();
  });

  it("credits a subject verification that carries no date of its own", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          claim: { status: "verified", verification_level: "subject-verified" },
          last_verified: undefined,
        })}
      />,
    );

    expect(screen.getByText("Representation verified.")).toBeInTheDocument();
    expect(screen.queryByText("Subject verified")).not.toBeInTheDocument();
  });

  it("dates a subject verification from the profile's own last-verified stamp", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          claim: { status: "verified", verification_level: "subject-verified" },
          last_verified: "2026-01-09T00:00:00Z",
        })}
      />,
    );

    expect(screen.getByText("Subject verified")).toBeInTheDocument();
    expect(screen.getByText("Representation verified Jan 2026.")).toBeInTheDocument();
  });

  it("says so when a representation claim was revoked", () => {
    render(
      <ProfileHistory
        entry={buildEntry({
          claim: { status: "revoked", verification_level: "source-derived" },
        })}
      />,
    );

    expect(screen.getByText("Representation verification no longer active.")).toBeInTheDocument();
  });
});
