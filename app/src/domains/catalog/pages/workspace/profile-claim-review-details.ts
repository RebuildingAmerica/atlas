import type { ProfileClaimProofResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas";

export interface EvidenceDetail {
  label: string;
  value: string;
}

export interface ProofFact {
  label: string;
  value: string;
}

export interface ProofDetail {
  facts: ProofFact[];
  label: string;
  status: string;
  value: string;
}

export function evidenceDetails(value: unknown): EvidenceDetail[] {
  const record = metadataRecord(value);
  return [
    detail("Relationship", record.relationship),
    detail("Evidence", record.evidence),
    detail("Requested changes", record.requested_changes),
    detail("Contact", record.preferred_contact_channel),
    detail("Private note", record.private_note),
  ].filter(isPresent);
}

export function proofDetail(proof: ProfileClaimProofResponse): ProofDetail | null {
  const metadata = metadataRecord(proof.metadata);
  if (proof.proof_type === "atproto") {
    return {
      facts: atprotoFacts(metadata),
      label: "ATProto account",
      status: statusText(proof.proof_status),
      value: stringValue(metadata.handle) ?? proof.proof_summary,
    };
  }
  if (proof.proof_type === "sso_admin") {
    const name = stringValue(metadata.workspace_name);
    const role = stringValue(metadata.workspace_role);
    return {
      facts: [],
      label: "Workspace role",
      status: statusText(proof.proof_status),
      value: [name, role].filter(Boolean).join(" - ") || proof.proof_summary,
    };
  }
  if (proof.proof_type === "domain_dns") {
    return {
      facts: dnsRecordFacts(metadata),
      label: "Organization domain",
      status: statusText(proof.proof_status),
      value: stringValue(metadata.domain) ?? proof.proof_summary,
    };
  }
  return {
    facts: [],
    label: "Review note",
    status: statusText(proof.proof_status),
    value: proof.proof_summary,
  };
}

export function statusText(status: string): string {
  if (status === "verified") return "Confirmed";
  if (status === "rejected") return "Rejected";
  return "Needs review";
}

function atprotoFacts(metadata: Record<string, unknown>): ProofFact[] {
  const facts = [
    detail("DID", metadata.did),
    detail("PDS", metadata.pds_url),
    detail("Profile domain", stringList(metadata.entry_domains).join(", ")),
  ].filter(isPresent);

  if (metadata.handle_domain_matches_entry === false) {
    facts.push({ label: "Domain match", value: "Needs DNS or workspace" });
  } else if (metadata.handle_domain_matches_entry === true) {
    facts.push({ label: "Domain match", value: "Matches profile domain" });
  }
  if (metadata.handle_is_generic === true) {
    facts.push({ label: "Handle type", value: "Bluesky-hosted account" });
  }

  return facts;
}

function dnsRecordFacts(metadata: Record<string, unknown>): ProofFact[] {
  return [
    detail("TXT host", metadata.challenge_host),
    detail("TXT value", metadata.challenge_value),
  ].filter(isPresent);
}

function detail(label: string, value: unknown): EvidenceDetail | null {
  const text = stringValue(value);
  return text ? { label, value: text } : null;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isPresent<Value>(value: Value | null): value is Value {
  return value !== null;
}
