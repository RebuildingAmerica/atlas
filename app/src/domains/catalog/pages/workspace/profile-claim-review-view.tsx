import { Link } from "@tanstack/react-router";
import { Check, ExternalLink, RefreshCw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import {
  AdminIndicatorCard,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
} from "@/domains/admin/admin-portal";
import type { ProfileClaimResponse } from "@/lib/generated/atlas";
import { Button } from "@/platform/ui/button";
import {
  evidenceDetails,
  proofDetail,
  type EvidenceDetail,
  type ProofDetail,
} from "./profile-claim-review-details";

interface ProfileClaimReviewViewProps {
  approving: boolean;
  atprotoStatus: string;
  claims: ProfileClaimResponse[];
  onApprove: (claim: ProfileClaimResponse, note: string) => void;
  onReject: (claim: ProfileClaimResponse, note: string) => void;
  onRevalidateAtproto: () => void;
  revalidatingAtproto: boolean;
  rejecting: boolean;
  total: number;
}

export function ProfileClaimReviewView({
  approving,
  atprotoStatus,
  claims,
  onApprove,
  onReject,
  onRevalidateAtproto,
  revalidatingAtproto,
  rejecting,
  total,
}: ProfileClaimReviewViewProps) {
  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Reviewer queue"
        title="Profile verifications"
        description="Confirm representative access only when the submitted sources match the public profile."
      >
        <div className="grid gap-3 sm:min-w-80 sm:grid-cols-2">
          <AdminIndicatorCard
            label="Waiting"
            value={String(total)}
            detail="Needs source review"
            tone={total > 0 ? "warn" : "pass"}
          />
          <div className="border-border bg-surface-container-lowest rounded-lg border p-5">
            <p className="type-label-small text-ink-muted">ATProto links</p>
            <p className="type-title-small text-ink-strong mt-2">{atprotoStatus}</p>
            <Button
              ariaLabel="Recheck ATProto links"
              className="mt-3"
              onClick={onRevalidateAtproto}
              disabled={revalidatingAtproto}
              size="sm"
              variant="secondary"
            >
              <RefreshCw className="mr-2 inline h-4 w-4" aria-hidden />
              {revalidatingAtproto ? "Checking" : "Recheck"}
            </Button>
          </div>
        </div>
      </AdminPageHeader>

      {claims.length === 0 ? (
        <div className="border-border bg-surface-container-lowest rounded-lg border p-6 text-center">
          <p className="type-body-medium text-ink-soft">No verifications waiting.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {claims.map((claim) => (
            <ReviewCard
              key={claim.id}
              approving={approving}
              claim={claim}
              onApprove={onApprove}
              onReject={onReject}
              rejecting={rejecting}
            />
          ))}
        </div>
      )}
    </AdminPageShell>
  );
}

interface ReviewCardProps {
  approving: boolean;
  claim: ProfileClaimResponse;
  onApprove: (claim: ProfileClaimResponse, note: string) => void;
  onReject: (claim: ProfileClaimResponse, note: string) => void;
  rejecting: boolean;
}

function ReviewCard({ approving, claim, onApprove, onReject, rejecting }: ReviewCardProps) {
  const proofs = (claim.proofs ?? []).map((proof) => proofDetail(proof)).filter(isPresent);
  const evidence = evidenceDetails(claim.evidence);
  const warnings = reviewWarnings(proofs);
  const [reviewerNote, setReviewerNote] = useState("");

  return (
    <article className="border-border bg-surface-container-lowest rounded-lg border p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-title-large text-ink-strong">{claim.entry_name}</h2>
            <AdminStatusBadge tone="warn" compact>
              Needs review
            </AdminStatusBadge>
          </div>
          <p className="type-body-small text-ink-soft">{claim.user_email}</p>
          {claim.entry_slug ? (
            <Link
              to="/claim/$slug"
              params={{ slug: claim.entry_slug }}
              className="type-label-medium text-accent hover:text-accent-ink inline-flex items-center gap-1"
            >
              Open verification
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            ariaLabel={`Approve ${claim.entry_name}`}
            onClick={() => {
              onApprove(claim, reviewerNote);
            }}
            disabled={approving || rejecting}
          >
            <Check className="mr-2 inline h-4 w-4" aria-hidden />
            Approve
          </Button>
          <Button
            ariaLabel={`Reject ${claim.entry_name}`}
            onClick={() => {
              onReject(claim, reviewerNote);
            }}
            disabled={approving || rejecting}
            variant="secondary"
          >
            <X className="mr-2 inline h-4 w-4" aria-hidden />
            Reject
          </Button>
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="border-outline-variant mt-4 rounded-lg border bg-yellow-50 px-4 py-3 text-yellow-900">
          {warnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p className="type-body-small">{warning}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.75fr)]">
        <section className="space-y-3">
          <h3 className="type-label-medium text-ink-strong">Submitted details</h3>
          {evidence.length > 0 ? (
            <dl className="grid gap-2">
              {evidence.map((item) => (
                <DetailRow key={item.label} label={item.label} value={item.value} />
              ))}
            </dl>
          ) : (
            <p className="type-body-small text-ink-soft">No note provided.</p>
          )}
        </section>
        <section className="space-y-3">
          <h3 className="type-label-medium text-ink-strong">Verification sources</h3>
          {proofs.length > 0 ? (
            <dl className="grid gap-2">
              {proofs.map((proof) => (
                <ProofRow key={`${proof.label}-${proof.value}`} proof={proof} />
              ))}
            </dl>
          ) : (
            <p className="type-body-small text-ink-soft">No verification sources attached.</p>
          )}
        </section>
      </div>
      <label className="mt-4 block space-y-2">
        <span className="type-label-medium text-ink-strong">Reviewer note</span>
        <textarea
          aria-label="Reviewer note"
          className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
          rows={3}
          value={reviewerNote}
          onChange={(event) => {
            setReviewerNote(event.target.value);
          }}
        />
      </label>
    </article>
  );
}

function reviewWarnings(proofs: ProofDetail[]): string[] {
  const hasGenericAtprotoWithoutDomainMatch = proofs.some((proof) => {
    if (proof.label !== "ATProto account") return false;
    const hasGenericHandle = proof.facts.some(
      (fact) => fact.label === "Handle type" && fact.value === "Bluesky-hosted account",
    );
    const needsBacking = proof.facts.some(
      (fact) => fact.label === "Domain match" && fact.value === "Needs DNS or workspace",
    );
    return hasGenericHandle && needsBacking;
  });
  if (!hasGenericAtprotoWithoutDomainMatch) return [];
  return [
    "Confirm the organization domain or workspace role before approving this ATProto account.",
  ];
}

function DetailRow({ label, value }: EvidenceDetail) {
  return (
    <div className="bg-surface-container rounded-lg p-3">
      <dt className="type-label-small text-ink-muted">{label}</dt>
      <dd className="type-body-small text-ink-strong mt-1 break-words">{value}</dd>
    </div>
  );
}

function ProofRow({ proof }: { proof: ProofDetail }) {
  return (
    <div className="bg-surface-container rounded-lg p-3">
      <div className="flex items-start gap-2">
        <ShieldCheck className="text-ink-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <dt className="type-label-small text-ink-muted">{proof.label}</dt>
          <dd className="type-body-small text-ink-strong mt-1 break-words">{proof.value}</dd>
          {proof.facts.length > 0 ? (
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {proof.facts.map((fact) => (
                <div
                  key={`${fact.label}-${fact.value}`}
                  className="border-outline-variant bg-surface-container-lowest rounded-md border px-2 py-1.5"
                >
                  <dt className="type-label-small text-ink-muted">{fact.label}</dt>
                  <dd className="type-body-small text-ink-strong break-words">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        <span className="type-label-small text-ink-soft shrink-0">{proof.status}</span>
      </div>
    </div>
  );
}

function isPresent<Value>(value: Value | null): value is Value {
  return value !== null;
}
