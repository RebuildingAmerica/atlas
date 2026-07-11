import { Link } from "@tanstack/react-router";
import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import type { ProfileClaimProofResponse, ProfileClaimResponse } from "@/lib/generated/atlas";
import { Badge } from "@/platform/ui/badge";
import { Button } from "@/platform/ui/button";
import { SurfaceSection } from "@/platform/ui/surface-section";
import type { Entry } from "@/types";
import { ClaimDnsRecordPanel, type DnsRecordMetadata } from "./-claim-dns-record-panel";

export interface ClaimHeroProps {
  entry: Entry;
}

export function ClaimHero({ entry }: ClaimHeroProps) {
  const isOrganization = entry.type === "organization";
  const trustMessage = isOrganization
    ? "Show that updates come from someone connected to it."
    : "Show that updates come from the person named here.";

  return (
    <header className="mt-8 max-w-3xl space-y-3">
      <Badge variant="info">Profile verification</Badge>
      <h1 className="type-display-small text-ink-strong">{entry.name}</h1>
      <p className="type-body-large text-ink-soft max-w-2xl">
        {isOrganization
          ? "Verify that you can represent this organization."
          : "Verify that this profile is about you."}{" "}
        {trustMessage}
      </p>
    </header>
  );
}

export interface SignedOutPanelProps {
  redirectTo: string;
  slug: string;
}

export function SignedOutPanel({ redirectTo }: SignedOutPanelProps) {
  return (
    <SurfaceSection>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl space-y-2">
          <p className="type-label-small text-ink-muted uppercase">Account required</p>
          <h2 className="type-title-large text-ink-strong">Sign in to verify this profile</h2>
          <p className="type-body-medium text-ink-soft">
            Use an account you control so verification is tied to you.
          </p>
        </div>
        <Link
          to="/sign-in"
          search={{
            redirect: redirectTo,
          }}
          className="bg-primary text-on-primary type-label-large inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 font-semibold"
        >
          Sign in to continue
        </Link>
      </div>
    </SurfaceSection>
  );
}

export interface VerificationTokenPanelProps {
  isPending: boolean;
  onVerify: () => void;
}

export function VerificationTokenPanel({ isPending, onVerify }: VerificationTokenPanelProps) {
  return (
    <SurfaceSection
      icon={ShieldCheck}
      title="Verify by email"
      description="Confirm the link sent to your email."
    >
      <Button onClick={onVerify} disabled={isPending}>
        {isPending ? "Verifying..." : "Confirm verification"}
      </Button>
    </SurfaceSection>
  );
}

export interface VerifiedClaimPanelProps {
  entry: Entry;
  profilePath: string;
}

export function VerifiedClaimPanel({ entry, profilePath }: VerifiedClaimPanelProps) {
  const verifiedMessage =
    entry.type === "organization"
      ? "This organization now has a verified representative."
      : "Readers can now see that this profile is verified.";

  return (
    <SurfaceSection
      icon={CheckCircle2}
      title="Profile verified"
      description={verifiedMessage}
      tone="success"
    >
      <div className="flex flex-wrap gap-3">
        <Link
          to="/manage/$slug"
          params={{ slug: entry.slug }}
          className="bg-primary text-on-primary type-label-large inline-flex items-center gap-2 rounded-full px-5 py-2 font-semibold"
        >
          Edit profile
        </Link>
        <Link
          to={profilePath as "/profiles"}
          className="type-label-large border-outline-variant bg-surface-container-lowest text-on-surface inline-flex items-center gap-2 rounded-full border px-5 py-2 font-medium"
        >
          View public profile
        </Link>
      </div>
    </SurfaceSection>
  );
}

export interface PendingClaimPanelProps {
  claim: ProfileClaimResponse;
  isVerifyingDomain: boolean;
  onVerifyDomain: (claimId: string) => Promise<boolean>;
}

interface ProofDetail {
  label: string;
  status: string;
  value: string;
}

function pendingDnsRecord(claim: ProfileClaimResponse): DnsRecordMetadata | null {
  const proof = claim.proofs?.find(
    (item) => item.proof_type === "domain_dns" && item.proof_status === "pending",
  );
  if (!proof || typeof proof.metadata !== "object" || proof.metadata === null) {
    return null;
  }
  const metadata = proof.metadata as DnsRecordMetadata;
  if (!metadata.challenge_host || !metadata.challenge_value) {
    return null;
  }
  return metadata;
}

function proofDetails(claim: ProfileClaimResponse): ProofDetail[] {
  return (
    claim.proofs
      ?.map((proof) => proofDetail(proof))
      .filter((detail): detail is ProofDetail => detail !== null) ?? []
  );
}

function proofDetail(proof: ProfileClaimProofResponse): ProofDetail | null {
  const metadata = metadataRecord(proof.metadata);
  if (proof.proof_type === "atproto") {
    return {
      label: "ATProto account",
      status: proofStatusText(proof.proof_status),
      value: stringMetadata(metadata, "handle") ?? proof.proof_summary,
    };
  }
  if (proof.proof_type === "sso_admin") {
    const workspaceName = stringMetadata(metadata, "workspace_name");
    const workspaceRole = stringMetadata(metadata, "workspace_role");
    return {
      label: "Workspace role",
      status: proofStatusText(proof.proof_status),
      value: [workspaceName, workspaceRole].filter(Boolean).join(" - ") || proof.proof_summary,
    };
  }
  if (proof.proof_type === "domain_dns") {
    const domain = stringMetadata(metadata, "domain");
    if (!domain) {
      return null;
    }
    return {
      label: "Organization domain",
      status: proofStatusText(proof.proof_status),
      value: domain,
    };
  }
  return null;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function proofStatusText(status: string): string {
  if (status === "verified") {
    return "Confirmed";
  }
  if (status === "rejected") {
    return "Rejected";
  }
  return "Needs review";
}

export function PendingClaimPanel({
  claim,
  isVerifyingDomain,
  onVerifyDomain,
}: PendingClaimPanelProps) {
  const dnsRecord = pendingDnsRecord(claim);
  const details = proofDetails(claim);

  return (
    <SurfaceSection
      icon={Clock}
      title="Verification under review"
      description={
        claim.tier === 1
          ? "Check your email to finish verification."
          : "A reviewer is checking the connection."
      }
    >
      {details.length > 0 ? (
        <div className="border-outline-variant bg-surface-container-lowest rounded-lg border p-4">
          <p className="type-label-medium text-ink-strong">Connection details</p>
          <dl className="mt-3 grid gap-2">
            {details.map((detail) => (
              <ProofDetailRow key={`${detail.label}-${detail.value}`} detail={detail} />
            ))}
          </dl>
        </div>
      ) : null}
      {dnsRecord ? (
        <ClaimDnsRecordPanel
          dnsRecord={dnsRecord}
          isChecking={isVerifyingDomain}
          onCheck={() => onVerifyDomain(claim.id)}
        />
      ) : null}
    </SurfaceSection>
  );
}

interface ProofDetailRowProps {
  detail: ProofDetail;
}

function ProofDetailRow({ detail }: ProofDetailRowProps) {
  return (
    <div className="bg-surface-container flex flex-col gap-2 rounded-lg p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <dt className="type-label-small text-ink-muted">{detail.label}</dt>
        <dd className="type-body-small text-ink-strong mt-0.5 break-words">{detail.value}</dd>
      </div>
      <span className="type-label-small border-outline-variant bg-surface-container-lowest text-ink-soft inline-flex w-fit shrink-0 rounded-full border px-2 py-0.5">
        {detail.status}
      </span>
    </div>
  );
}
