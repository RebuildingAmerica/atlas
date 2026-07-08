import { vi } from "vitest";
import type { ClaimSubmissionPanelProps } from "@/routes/_public/claim/-claim-submission-panel";
import type { Entry } from "@/types";

export const claimPanelNoop = vi.fn();

export function createClaimSubmissionPanelProps(
  overrides: Partial<ClaimSubmissionPanelProps> = {},
): ClaimSubmissionPanelProps {
  return {
    activeWorkspaceName: null,
    atprotoConnectionChanged: false,
    atprotoHandle: "",
    atprotoLoginHandle: "",
    dnsDomain: "",
    evidence: "",
    isPending: false,
    onAtprotoLoginHandleChange: claimPanelNoop,
    onConnectAtproto: claimPanelNoop,
    onDnsDomainChange: claimPanelNoop,
    onEvidenceChange: claimPanelNoop,
    onPreferredContactChannelChange: claimPanelNoop,
    onPrivateNoteChange: claimPanelNoop,
    onRelationshipChange: claimPanelNoop,
    onRequestedChangesChange: claimPanelNoop,
    onSubmit: claimPanelNoop,
    onUseActiveWorkspaceChange: claimPanelNoop,
    preferredContactChannel: "",
    privateNote: "",
    relationship: "organization_representative",
    requestedChanges: "",
    showOrganizationProofs: true,
    useActiveWorkspace: false,
    ...overrides,
  };
}

export function createOrganizationEntry(): Entry {
  return {
    id: "e1",
    name: "Eastside Housing Network",
    slug: "eastside-housing-network",
    type: "organization",
    source_count: 2,
    website: "https://eastsidehousing.org",
  } as Entry;
}

export function staleClaimCopyPatterns() {
  return {
    genericHandle: new RegExp(["tied", "back"].join(" "), "i"),
    privateProof: new RegExp(["private", "note", "and", "proof"].join(" "), "i"),
    process: new RegExp(["After", "verification"].join(" "), "i"),
    relationshipProof: new RegExp(["Proof", "of", "relationship"].join(" "), "i"),
    visibility: new RegExp(["Public", "vs", "private"].join(" "), "i"),
    workspaceAvailability: new RegExp(["Available", "when"].join(" "), "i"),
  };
}
