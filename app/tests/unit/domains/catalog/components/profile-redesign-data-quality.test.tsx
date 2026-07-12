// @vitest-environment jsdom

import "./profile-redesign-test-setup";

import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import type { Entry } from "@/types";
import { createEntryFixture as buildEntry } from "../../../../fixtures/catalog/entries";

describe("DataQualityBlock", () => {
  const trust = (overrides: Partial<Entry["trust"]>): Entry["trust"] => ({
    level: "unverified",
    independent_source_count: null,
    website_grounded: null,
    email_grounded: null,
    ...overrides,
  });

  it("renders Atlas-verified for the atlas_verified trust tier", () => {
    render(<DataQualityBlock entry={buildEntry({ trust: trust({ level: "atlas_verified" }) })} />);
    expect(screen.getByText("Atlas-verified")).toBeInTheDocument();
  });

  it("renders an honest 'Single source' for the unverified tier, never 'Source-derived'", () => {
    render(<DataQualityBlock entry={buildEntry({ trust: trust({ level: "unverified" }) })} />);
    expect(screen.getByText("Single source")).toBeInTheDocument();
    expect(screen.queryByText("Source-derived")).toBeNull();
  });

  it("shows corroboration breadth for the corroborated tier", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({ trust: trust({ level: "corroborated", independent_source_count: 3 }) })}
      />,
    );
    expect(screen.getByText("Corroborated · 3 independent sources")).toBeInTheDocument();
  });

  it("shows the representative ATProto handle for verified organization profiles", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          type: "organization",
          claim: {
            status: "verified",
            verification_level: "subject-verified",
            claim_verified_at: "2026-07-07T12:00:00Z",
            linked_atproto_handle: "mississippirising.org",
            linked_atproto_did: "did:plc:mississippirising",
            linked_atproto_verified_at: "2026-07-07T12:00:00Z",
          },
        })}
      />,
    );

    expect(screen.getByText(/Verified representative/)).toBeInTheDocument();
    expect(screen.queryByText(/Verified by subject/)).not.toBeInTheDocument();
    expect(screen.getByText("Representative ATProto account")).toBeInTheDocument();
    expect(screen.getByText("mississippirising.org")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /mississippirising.org/ })).toBeNull();
    expect(screen.getByText("Verified Jul 2026")).toBeInTheDocument();
  });

  it("shows a personal ATProto label for verified person profiles", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          type: "person",
          claim: {
            status: "verified",
            verification_level: "subject-verified",
            claim_verified_at: "2026-07-07T12:00:00Z",
            linked_atproto_handle: "jane.example",
            linked_atproto_did: "did:plc:jane",
            linked_atproto_verified_at: "2026-07-07T12:00:00Z",
          },
        })}
      />,
    );

    expect(screen.getByText("ATProto account")).toBeInTheDocument();
    expect(screen.queryByText("Representative ATProto account")).not.toBeInTheDocument();
    expect(screen.getByText("jane.example")).toBeInTheDocument();
  });

  it("shows identity health without publishing a stale handle", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim: {
            status: "verified",
            verification_level: "subject-verified",
            linked_atproto_handle: "stale.example",
            linked_atproto_status: "needs_attention",
          },
        })}
      />,
    );

    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.queryByText("stale.example")).toBeNull();
  });

  it("uses the singular for a single corroborating source", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({ trust: trust({ level: "corroborated", independent_source_count: 1 }) })}
      />,
    );
    expect(screen.getByText("Corroborated · 1 independent source")).toBeInTheDocument();
  });

  it("renders a bare 'Corroborated' when the independent source count is unknown", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          trust: trust({ level: "corroborated", independent_source_count: null }),
        })}
      />,
    );
    expect(screen.getByText("Corroborated")).toBeInTheDocument();
  });

  it("shows the source count", () => {
    render(<DataQualityBlock entry={buildEntry({ source_count: 12 })} />);
    expect(screen.getByText("12 sources")).toBeInTheDocument();
  });

  it("shows canonical profile coverage for complete actor records", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          description: "Runs tenant organizing campaigns.",
          city: "Jackson",
          state: "MS",
          issue_areas: ["housing_affordability"],
          source_count: 3,
          website: "https://janedoe.example",
        })}
      />,
    );

    expect(screen.getByText("Profile shape")).toBeInTheDocument();
    expect(screen.getByText("6 of 6 core fields")).toBeInTheDocument();
    const shapeFields = within(screen.getByLabelText("Canonical profile fields"));
    for (const label of ["Identity", "Work", "Place", "Issues", "Sources", "Contact"]) {
      expect(shapeFields.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows missing canonical profile fields without implementation copy", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          description: "",
          city: undefined,
          state: undefined,
          issue_areas: [],
          source_count: 0,
          website: undefined,
          email: undefined,
          phone: undefined,
          social_media: undefined,
        })}
      />,
    );

    expect(screen.getByText("1 of 6 core fields")).toBeInTheDocument();
    expect(screen.getByText("Missing Work, Place, Issues, Sources, Contact")).toBeInTheDocument();
    expect(screen.queryByText(/still gathering/i)).not.toBeInTheDocument();
  });

  it("renders claim-level evidence for visible profile facts", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim_evidence: {
            summary: {
              source_count: 3,
              source_ids: ["source-1", "source-2", "source-3"],
              confidence: "corroborated",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            place: {
              source_count: 3,
              source_ids: ["source-1", "source-2", "source-3"],
              confidence: "corroborated",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            issues: {
              source_count: 3,
              source_ids: ["source-1", "source-2", "source-3"],
              confidence: "corroborated",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            contact: {
              source_count: 1,
              source_ids: ["source-1"],
              confidence: "partial",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
          },
        })}
      />,
    );

    expect(screen.getByText("Verification evidence")).toBeInTheDocument();
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getAllByText("Place").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issues").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Contact").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3 sources · corroborated · Apr 2026/)).toHaveLength(3);
    expect(screen.getByText(/1 source · partial · Apr 2026/)).toBeInTheDocument();
  });

  it("shows lead-quality signals from geography, freshness, source mix, and contact data", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          latest_source_date: new Date().toISOString(),
          source_types: ["news_article", "report"],
          website: "https://example.org",
        })}
      />,
    );

    expect(screen.getByText("Lead signals")).toBeInTheDocument();
    expect(screen.getByText("Local lead")).toBeInTheDocument();
    expect(screen.getByText("Recent source")).toBeInTheDocument();
    expect(screen.getByText("Diverse sources")).toBeInTheDocument();
    expect(screen.getByText("Reachable")).toBeInTheDocument();
  });

  it("shows actor-specificity quality for records with a concrete actor, work, place, issues, and sources", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          actor_quality: {
            level: "specific_actor",
            score: 5,
            total: 5,
            present: ["actor", "work", "place", "issues", "sources"],
            missing: [],
          },
        })}
      />,
    );

    expect(screen.getByText("Actor specificity")).toBeInTheDocument();
    expect(screen.getByText("5 of 5 specificity signals")).toBeInTheDocument();
    expect(screen.getByText("Specific actor")).toBeInTheDocument();
  });

  it("names missing actor-specificity fields without implementation copy", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          actor_quality: {
            level: "thin_record",
            score: 2,
            total: 5,
            present: ["actor", "sources"],
            missing: ["work", "place", "issues"],
          },
        })}
      />,
    );

    expect(screen.getByText("2 of 5 specificity signals")).toBeInTheDocument();
    expect(screen.getByText("Missing Work, Place, Issues")).toBeInTheDocument();
    expect(screen.queryByText(/still gathering/i)).not.toBeInTheDocument();
  });

  it("renders the inline verification CTA for unverified profiles", () => {
    render(<DataQualityBlock entry={buildEntry()} />);
    const cta = screen.getByRole("link", {
      name: /Represent Jane Doe\? Verify this profile/i,
    });
    expect(cta).toHaveAttribute("href", expect.stringContaining("/claim"));
  });

  it("surfaces representation, stale-data, and missing-context stewardship paths", () => {
    render(<DataQualityBlock entry={buildEntry({ id: "entry-1", slug: "jane-doe-a3f2" })} />);

    expect(screen.getByText("Corrections")).toBeInTheDocument();
    expect(screen.queryByText("Improve this record")).not.toBeInTheDocument();

    const claim = screen.getByRole("link", { name: "Verify or correct representation" });
    expect(claim).toHaveAttribute("href", "/claim/$slug");
    expect(claim).toHaveAttribute("data-link-params", JSON.stringify({ slug: "jane-doe-a3f2" }));

    const report = screen.getByRole("link", { name: "Report stale or incorrect information" });
    expect(report).toHaveAttribute("href", "/feedback/$slug");
    expect(report).toHaveAttribute("data-link-params", JSON.stringify({ slug: "jane-doe-a3f2" }));
    expect(report).toHaveAttribute("data-link-search", JSON.stringify({ kind: "incorrect" }));

    const missing = screen.getByRole("link", { name: "Suggest missing context" });
    expect(missing).toHaveAttribute("href", "/feedback/$slug");
    expect(missing).toHaveAttribute(
      "data-link-search",
      JSON.stringify({ kind: "missing_context" }),
    );
  });

  it("hides the verification CTA once the profile is verified by subject", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim: { status: "verified", verification_level: "subject-verified" },
        })}
      />,
    );
    expect(screen.queryByRole("link", { name: /verify this profile/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Verified person/i)).toBeInTheDocument();
    expect(screen.queryByText(/Verified by subject/i)).not.toBeInTheDocument();
  });

  it("shows the pending status without a verification CTA while verification is under review", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim: { status: "pending", verification_level: "source-derived" },
        })}
      />,
    );
    expect(screen.getByText(/Verification under review/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /verify this profile/i })).not.toBeInTheDocument();
  });

  it("appends the verification date when verified_at is present", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim: {
            status: "verified",
            verification_level: "subject-verified",
            claim_verified_at: "2026-01-15T00:00:00Z",
          },
        })}
      />,
    );
    expect(screen.getByText(/Verified person —/)).toBeInTheDocument();
  });

  it("renders the revoked verification CTA without the entry name", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim: { status: "revoked", verification_level: "source-derived" },
        })}
      />,
    );
    expect(screen.getByRole("link", { name: /^Verify this profile/ })).toBeInTheDocument();
  });

  it("uses the singular 'source' label when there is exactly one source", () => {
    render(<DataQualityBlock entry={buildEntry({ source_count: 1 })} />);
    expect(screen.getByText("1 source")).toBeInTheDocument();
  });

  it("falls back to last_seen when latest_source_date is not available", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          last_seen: new Date().toISOString(),
        })}
      />,
    );
    expect(screen.getAllByText(/today|d ago/).length).toBeGreaterThan(0);
  });
});
