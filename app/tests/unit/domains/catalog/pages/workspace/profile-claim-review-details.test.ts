import { describe, expect, it } from "vitest";
import type { ProfileClaimProofResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas";
import {
  evidenceDetails,
  proofDetail,
  statusText,
} from "@/domains/catalog/pages/workspace/profile-claim-review-details";

describe("profile claim review details", () => {
  function proof(overrides: Partial<ProfileClaimProofResponse> = {}): ProfileClaimProofResponse {
    return {
      created_at: "2026-01-01T00:00:00Z",
      id: "proof_1",
      proof_status: "pending",
      proof_summary: "A short summary of the proof.",
      proof_type: "note",
      ...overrides,
    };
  }

  describe("evidenceDetails", () => {
    it("lists what the claimant said about themselves, in reviewer order", () => {
      expect(
        evidenceDetails({
          evidence: "Staff directory lists me as comms lead.",
          preferred_contact_channel: "email",
          private_note: "Prefers not to be called at work.",
          relationship: "staff",
          requested_changes: "Update the bio.",
        }),
      ).toEqual([
        { label: "Relationship", value: "staff" },
        { label: "Evidence", value: "Staff directory lists me as comms lead." },
        { label: "Requested changes", value: "Update the bio." },
        { label: "Contact", value: "email" },
        { label: "Private note", value: "Prefers not to be called at work." },
      ]);
    });

    it("drops fields the claimant left blank rather than showing empty rows", () => {
      expect(
        evidenceDetails({ evidence: "   ", relationship: "board member", requested_changes: null }),
      ).toEqual([{ label: "Relationship", value: "board member" }]);
    });

    it("returns nothing when the claim carries no structured evidence at all", () => {
      expect(evidenceDetails(null)).toEqual([]);
      expect(evidenceDetails("a string is not evidence")).toEqual([]);
    });
  });

  describe("statusText", () => {
    it("reads a proof's state in reviewer language", () => {
      expect(statusText("verified")).toBe("Confirmed");
      expect(statusText("rejected")).toBe("Rejected");
      expect(statusText("pending")).toBe("Needs review");
    });
  });

  describe("proofDetail", () => {
    it("shows an ATProto handle with the identity facts behind it", () => {
      expect(
        proofDetail(
          proof({
            metadata: {
              did: "did:plc:abc",
              entry_domains: ["casaverde.org", "", 7],
              handle: "casaverde.org",
              handle_domain_matches_entry: true,
              pds_url: "https://pds.example",
            },
            proof_status: "verified",
            proof_type: "atproto",
          }),
        ),
      ).toEqual({
        facts: [
          { label: "DID", value: "did:plc:abc" },
          { label: "PDS", value: "https://pds.example" },
          { label: "Profile domain", value: "casaverde.org" },
          { label: "Domain match", value: "Matches profile domain" },
        ],
        label: "ATProto account",
        status: "Confirmed",
        value: "casaverde.org",
      });
    });

    it("warns a reviewer when a handle's domain does not match the profile", () => {
      const detail = proofDetail(
        proof({
          metadata: { handle: "someone.bsky.social", handle_domain_matches_entry: false },
          proof_type: "atproto",
        }),
      );

      expect(detail?.facts).toEqual([{ label: "Domain match", value: "Needs DNS or workspace" }]);
    });

    it("flags a Bluesky-hosted handle so it is not mistaken for a domain proof", () => {
      const detail = proofDetail(
        proof({
          metadata: { handle: "someone.bsky.social", handle_is_generic: true },
          proof_type: "atproto",
        }),
      );

      expect(detail?.facts).toEqual([{ label: "Handle type", value: "Bluesky-hosted account" }]);
    });

    it("falls back to the summary when an ATProto proof carries no handle", () => {
      expect(proofDetail(proof({ proof_type: "atproto" }))?.value).toBe(
        "A short summary of the proof.",
      );
    });

    it("names the workspace and role behind an SSO admin proof", () => {
      expect(
        proofDetail(
          proof({
            metadata: { workspace_name: "Casa Verde", workspace_role: "owner" },
            proof_status: "rejected",
            proof_type: "sso_admin",
          }),
        ),
      ).toEqual({
        facts: [],
        label: "Workspace role",
        status: "Rejected",
        value: "Casa Verde - owner",
      });
    });

    it("falls back to the summary when the workspace proof names neither side", () => {
      expect(proofDetail(proof({ proof_type: "sso_admin" }))?.value).toBe(
        "A short summary of the proof.",
      );
    });

    it("shows the TXT record a reviewer has to check for a domain proof", () => {
      expect(
        proofDetail(
          proof({
            metadata: {
              challenge_host: "_atlas.casaverde.org",
              challenge_value: "atlas-verify=abc123",
              domain: "casaverde.org",
            },
            proof_type: "domain_dns",
          }),
        ),
      ).toEqual({
        facts: [
          { label: "TXT host", value: "_atlas.casaverde.org" },
          { label: "TXT value", value: "atlas-verify=abc123" },
        ],
        label: "Organization domain",
        status: "Needs review",
        value: "casaverde.org",
      });
    });

    it("falls back to the summary when a domain proof names no domain", () => {
      expect(proofDetail(proof({ proof_type: "domain_dns" }))?.value).toBe(
        "A short summary of the proof.",
      );
    });

    it("presents any other proof as a plain review note", () => {
      expect(proofDetail(proof({ proof_summary: "Emailed a staff badge." }))).toEqual({
        facts: [],
        label: "Review note",
        status: "Needs review",
        value: "Emailed a staff badge.",
      });
    });
  });
});
