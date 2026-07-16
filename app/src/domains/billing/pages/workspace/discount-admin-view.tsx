import type { VerificationRecordResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas-schemas/access/verificationRecordResponse";
import type { VerificationUpdateRequest } from "@rebuildingamerica/atlas-api-client/generated/atlas-schemas/access/verificationUpdateRequest";
import {
  AdminIndicatorCard,
  AdminIndicatorPlaceholderCard,
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
  type AdminIndicatorTone,
} from "@/domains/admin/admin-portal";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { DISCOUNT_SEGMENT_LABELS } from "../../discount-segments";

export type VerificationReviewStatus = VerificationUpdateRequest["status"];

interface DiscountAdminViewProps {
  errorMessage?: string;
  isLoading?: boolean;
  onReview: (record: VerificationRecordResponse, status: VerificationReviewStatus) => void;
  records: VerificationRecordResponse[];
  reviewPending: boolean;
  total: number;
}

export function DiscountAdminView({
  errorMessage,
  isLoading = false,
  onReview,
  records,
  reviewPending,
  total,
}: DiscountAdminViewProps) {
  const pending = records.filter((record) => record.status === "pending").length;
  const verified = records.filter((record) => record.status === "verified").length;
  const rejected = records.filter((record) => record.status === "rejected").length;

  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Reviewer queue"
        title="Discount verifications"
        description="Resolve submitted requests for discounted Atlas access."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <>
            <AdminIndicatorPlaceholderCard label="Total requests" detail="All records" />
            <AdminIndicatorPlaceholderCard
              label="Pending review"
              detail="Needs operator decision"
            />
            <AdminIndicatorPlaceholderCard label="Verified" detail="Approved" />
            <AdminIndicatorPlaceholderCard label="Rejected" detail="Declined" />
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
              label="Pending review"
              value={String(pending)}
              detail="Needs operator decision"
              tone={pending > 0 ? "warn" : "pass"}
            />
            <AdminIndicatorCard
              label="Verified"
              value={String(verified)}
              detail="Approved"
              tone="pass"
            />
            <AdminIndicatorCard
              label="Rejected"
              value={String(rejected)}
              detail="Declined"
              tone={rejected > 0 ? "neutral" : "pass"}
            />
          </>
        )}
      </section>

      <section className="space-y-3" aria-busy={isLoading}>
        <h2 className="type-title-large text-ink-strong">Verification requests</h2>
        {errorMessage ? (
          <AdminInlineStatus message={errorMessage} />
        ) : records.length === 0 && !isLoading ? (
          <div className="border-border bg-surface-container-lowest rounded-lg border p-6 text-center">
            <p className="type-body-medium text-ink-soft">No verification requests yet.</p>
          </div>
        ) : records.length > 0 ? (
          <div className="grid gap-3">
            {records.map((record) => (
              <VerificationRecordCard
                key={record.id}
                onReview={onReview}
                record={record}
                reviewPending={reviewPending}
              />
            ))}
          </div>
        ) : null}
      </section>
    </AdminPageShell>
  );
}

function VerificationRecordCard({
  onReview,
  record,
  reviewPending,
}: {
  onReview: (record: VerificationRecordResponse, status: VerificationReviewStatus) => void;
  record: VerificationRecordResponse;
  reviewPending: boolean;
}) {
  return (
    <article className="border-border bg-surface-container-lowest rounded-lg border p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="type-title-small text-ink-strong">{record.user_id}</h3>
            <AdminStatusBadge tone="neutral" compact>
              {DISCOUNT_SEGMENT_LABELS[record.segment]}
            </AdminStatusBadge>
            <AdminStatusBadge tone={statusTone(record.status)} compact>
              {record.status}
            </AdminStatusBadge>
          </div>
          <p className="type-body-small text-ink-soft">
            Submitted: {formatSubmittedDate(record.submitted_at)}
          </p>
          {record.notes ? (
            <p className="type-body-small text-ink-strong italic">"{record.notes}"</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {record.status === "pending" ? (
            <>
              <Button
                disabled={reviewPending}
                onClick={() => {
                  onReview(record, "rejected");
                }}
                variant="secondary"
              >
                Reject
              </Button>
              <Button
                disabled={reviewPending}
                onClick={() => {
                  onReview(record, "verified");
                }}
              >
                Approve
              </Button>
            </>
          ) : null}
          <a
            href={`/admin/verifications/${record.id}`}
            className="type-label-small text-accent hover:text-accent-dark whitespace-nowrap underline"
          >
            View details
          </a>
        </div>
      </div>
    </article>
  );
}

function statusTone(status: VerificationRecordResponse["status"]): AdminIndicatorTone {
  if (status === "verified") {
    return "pass";
  }
  if (status === "rejected") {
    return "block";
  }
  return "warn";
}

function formatSubmittedDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
