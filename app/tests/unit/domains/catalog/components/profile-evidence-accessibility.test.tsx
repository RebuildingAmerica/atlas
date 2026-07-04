// @vitest-environment jsdom

import type { ReactNode } from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import { ProfileResearchContext } from "@/domains/catalog/components/profiles/profile-research-context";
import { ProfileSection } from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import {
  createEntryFixture as buildEntry,
  createSourceFixture as buildSource,
} from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/domains/catalog/components/profiles/private-notes-panel", () => ({
  PrivateNotesPanel: ({ targetLabel }: { targetLabel: string }) => (
    <div data-testid="private-notes">{targetLabel}</div>
  ),
}));

afterEach(cleanup);

describe("profile evidence accessibility", () => {
  it("makes every source packet reachable as a source link", () => {
    render(
      <AppearancesList
        mode="organization"
        sources={[
          buildSource({
            id: "lead",
            title: "Lead source",
            url: "https://example.org/lead",
            published_date: "2026-04-10",
          }),
          buildSource({
            id: "supporting",
            title: "Supporting source",
            url: "https://example.org/supporting",
            published_date: "2026-04-08",
          }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Lead source" })).toHaveAttribute(
      "href",
      "https://example.org/lead",
    );
    expect(screen.getByRole("heading", { name: "Appearances & coverage" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Supporting source" })).toHaveAttribute(
      "href",
      "https://example.org/supporting",
    );
    expect(document.getElementById("source-supporting")).not.toBeNull();
  });

  it("promotes unlabeled profile sections into the heading outline", () => {
    render(
      <ProfileSection label="Sources and trust" sectionId="sources-and-trust">
        <p>Trust details</p>
      </ProfileSection>,
    );

    expect(screen.getByRole("region", { name: "Sources and trust" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sources and trust" })).toBeInTheDocument();
  });

  it("exposes trust labels as headings inside the data quality block", () => {
    render(
      <DataQualityBlock
        entry={buildEntry({
          claim_evidence: {
            summary: {
              source_count: 2,
              source_ids: ["lead", "supporting"],
              confidence: "corroborated",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            place: {
              source_count: 1,
              source_ids: ["lead"],
              confidence: "partial",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            issues: {
              source_count: 2,
              source_ids: ["lead", "supporting"],
              confidence: "corroborated",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            contact: {
              source_count: 1,
              source_ids: ["supporting"],
              confidence: "partial",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
          },
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Verification" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Claim evidence" })).toBeInTheDocument();
  });

  it("exposes profile context evidence and correction groups with visible headings", () => {
    render(
      <ProfileResearchContext
        entry={buildEntry({ source_count: 3 })}
        issueAreaLabels={{ housing_affordability: "Housing affordability" }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Why this matters" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Corrections" })).toBeInTheDocument();
  });
});
