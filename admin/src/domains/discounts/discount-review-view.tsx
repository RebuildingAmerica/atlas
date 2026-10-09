import { useState } from "react";
import {
  AdminIndicatorCard,
  AdminIndicatorPlaceholderCard,
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
  type AdminIndicatorTone,
} from "@rebuildingamerica/atlas-ui/layout/admin-portal";
import {
  MEDIUM_DATE,
  useDateTimeFormatter,
} from "@rebuildingamerica/atlas-ui/format/date-time";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Textarea } from "@rebuildingamerica/atlas-ui/ui/textarea";
import type {
  VerificationRecordResponse,
  VerificationRecordResponseStatus,
  VerificationUpdateRequestStatus,
} from "@/generated/platform-schemas";
import { DISCOUNT_SEGMENT_LABELS } from "./discount-segments";

export interface DiscountDecision {
  notes: string;
  status: VerificationUpdateRequestStatus;
  verificationId: string;
}

interface DiscountReviewViewProps {
  /** Why the decision failed, or was saved without the applicant being emailed. */
  decisionMessage?: string;
  errorMessage?: string;
  isLoading: boolean;
  onDecide: (decision: DiscountDecision) => void;
  records: VerificationRecordResponse[];
  reviewPending: boolean;
  total: number;
}

interface RequestCardProps {
  onDecide: (decision: DiscountDecision) => void;
  record: VerificationRecordResponse;
  reviewPending: boolean;
}

export function DiscountReviewView({
  decisionMessage,
  errorMessage,
  isLoading,
  onDecide,
  records,
  reviewPending,
  total,
}: DiscountReviewViewProps) {
  const pending = records.filter(
    (record) => record.status === "pending",
  ).length;
  const verified = records.filter(
    (record) => record.status === "verified",
  ).length;
  const rejected = records.filter(
    (record) => record.status === "rejected",
  ).length;

  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Platform"
        title="Discount requests"
        description="Decide requests for discounted Atlas access. The applicant is emailed the outcome, and every decision is recorded under your name."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <>
            <AdminIndicatorPlaceholderCard
              label="Total requests"
              detail="All records"
            />
            <AdminIndicatorPlaceholderCard
              label="Pending"
              detail="Needs a decision"
            />
            <AdminIndicatorPlaceholderCard
              label="Approved"
              detail="Discount granted"
            />
            <AdminIndicatorPlaceholderCard
              label="Declined"
              detail="Not eligible"
            />
          </>
        ) : (
          <>
            <AdminIndicatorCard
              label="Total requests"
              value={String(total)}
              detail="All records"
              tone="neutral"
            />
            <AdminIndicatorCard
              label="Pending"
              value={String(pending)}
              detail="Needs a decision"
              tone={pending > 0 ? "warn" : "pass"}
            />
            <AdminIndicatorCard
              label="Approved"
              value={String(verified)}
              detail="Discount granted"
              tone="pass"
            />
            <AdminIndicatorCard
              label="Declined"
              value={String(rejected)}
              detail="Not eligible"
              tone="neutral"
            />
          </>
        )}
      </section>

      <AdminInlineStatus message={decisionMessage} />

      <section className="space-y-3" aria-busy={isLoading}>
        <h2 className="type-title-large text-ink-strong">Requests</h2>
        {errorMessage ? (
          <AdminInlineStatus message={errorMessage} />
        ) : records.length === 0 && !isLoading ? (
          <div className="border-border bg-surface-container-lowest rounded-lg border p-6 text-center">
            <p className="type-body-medium text-ink-soft">
              No discount requests yet.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {records.map((record) => (
              <RequestCard
                key={record.id}
                onDecide={onDecide}
                record={record}
                reviewPending={reviewPending}
              />
            ))}
          </div>
        )}
      </section>
    </AdminPageShell>
  );
}

function RequestCard({ onDecide, record, reviewPending }: RequestCardProps) {
  const formatDate = useDateTimeFormatter();
  const [reason, setReason] = useState("");
  const evidence = Object.entries(record.verification_data ?? {});
  const decide = (status: VerificationUpdateRequestStatus) => {
    onDecide({ notes: reason.trim(), status, verificationId: record.id });
  };

  return (
    <article className="border-border bg-surface-container-lowest rounded-lg border p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="type-title-small text-ink-strong">
          {DISCOUNT_SEGMENT_LABELS[record.segment]}
        </h3>
        <AdminStatusBadge tone={statusTone(record.status)} compact>
          {statusLabel(record.status)}
        </AdminStatusBadge>
      </div>
      <p className="type-body-small text-ink-soft mt-1">
        Workspace {record.organization_id} · submitted{" "}
        {formatDate(record.submitted_at, MEDIUM_DATE)}
      </p>

      {evidence.length > 0 ? (
        <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
          {evidence.map(([field, value]) => (
            <div key={field} className="contents">
              <dt className="type-label-medium text-ink-muted">{field}</dt>
              <dd className="type-body-small text-ink-strong break-all">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="type-body-small text-ink-soft mt-3">
          The applicant gave no evidence.
        </p>
      )}

      {record.status === "pending" ? (
        <div className="mt-4 space-y-3">
          <Textarea
            label="Reason"
            placeholder="What you checked, so the decision can be explained later"
            rows={2}
            value={reason}
            onChange={setReason}
            disabled={reviewPending}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={reviewPending || !reason.trim()}
              onClick={() => {
                decide("rejected");
              }}
            >
              Decline
            </Button>
            <Button
              disabled={reviewPending || !reason.trim()}
              onClick={() => {
                decide("verified");
              }}
            >
              Approve
            </Button>
          </div>
        </div>
      ) : record.notes ? (
        <p className="type-body-small text-ink-strong mt-3">
          Reason: {record.notes}
        </p>
      ) : null}
    </article>
  );
}

function statusTone(
  status: VerificationRecordResponseStatus,
): AdminIndicatorTone {
  if (status === "verified") return "pass";
  if (status === "rejected" || status === "expired") return "block";
  return "warn";
}

function statusLabel(status: VerificationRecordResponseStatus): string {
  if (status === "verified") return "Approved";
  if (status === "rejected") return "Declined";
  if (status === "expired") return "Expired";
  return "Pending";
}
