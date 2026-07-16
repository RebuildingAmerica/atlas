import { describe, expect, it } from "vitest";
import {
  blindSpotsForSummary,
  confidenceFromLead,
} from "./discovery-run-summary";
import {
  createDiscoveryResearchLeadFixture,
  createDiscoveryResearchSummaryFixture,
} from "../testing/discovery";

describe("discovery run summary derivation", () => {
  it("uses explicit confidence before deriving a fallback from source count", () => {
    expect(
      confidenceFromLead(
        createDiscoveryResearchLeadFixture({ confidence: "unverified", source_count: 5 }),
      ),
    ).toBe("unverified");
    expect(confidenceFromLead(createDiscoveryResearchLeadFixture({ source_count: 2 }))).toBe(
      "corroborated",
    );
    expect(confidenceFromLead(createDiscoveryResearchLeadFixture({ source_count: 1 }))).toBe(
      "partial",
    );
    expect(confidenceFromLead(createDiscoveryResearchLeadFixture({ source_count: 0 }))).toBe(
      "unverified",
    );
  });

  it("keeps actor-category blind spots and source gaps in a compact scan list", () => {
    const result = blindSpotsForSummary(
      "landscape_scan",
      createDiscoveryResearchSummaryFixture({
        gaps: [
          { label: "County groups", detail: "No suburban sources yet." },
          { label: "Spanish-language sources", detail: "No Spanish-language coverage yet." },
          { label: "Mutual aid", detail: "No mutual aid leads yet." },
        ],
        ranked_leads: [createDiscoveryResearchLeadFixture({ type: "organization" })],
      }),
    );

    expect(result).toEqual([
      { label: "Named people", detail: "No named person leads in the ranked set." },
      {
        label: "Initiatives and campaigns",
        detail: "No initiative or campaign leads in the ranked set.",
      },
      { label: "County groups", detail: "No suburban sources yet." },
      { label: "Spanish-language sources", detail: "No Spanish-language coverage yet." },
    ]);
  });
});
