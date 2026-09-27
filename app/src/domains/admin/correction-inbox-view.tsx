import type { CorrectionReport } from "./correction-inbox.functions";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { AdminInlineStatus, AdminPageHeader, AdminPageShell } from "./admin-portal";

export interface CorrectionInboxViewProps {
  decisionError?: string;
  errorMessage?: string;
  isLoading: boolean;
  items: CorrectionReport[];
  offset: number;
  onDecision: (itemId: string, decision: "resolve" | "dismiss") => void;
  onPageChange: (offset: number) => void;
  pageSize: number;
  pendingItemId?: string;
  total: number;
}

export function CorrectionInboxView({
  decisionError,
  errorMessage,
  isLoading,
  items,
  offset,
  onDecision,
  onPageChange,
  pageSize,
  pendingItemId,
  total,
}: CorrectionInboxViewProps) {
  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Private reports"
        title="Profile corrections"
        description="Review public profile concerns, fix the underlying fact when needed, then close the report. Reporter notes and contact details stay in this editor-only view."
      />
      <section aria-label="Open profile reports" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="type-title-large text-ink-strong">Waiting for review</h2>
          <span className="type-body-small text-ink-soft">{total} open</span>
        </div>
        <AdminInlineStatus message={errorMessage} />
        <AdminInlineStatus message={decisionError} />
        {isLoading ? (
          <div
            aria-busy
            className="border-border bg-surface-container-lowest h-24 rounded-lg border"
          />
        ) : items.length === 0 && !errorMessage ? (
          <div className="border-border bg-surface-container-lowest rounded-lg border p-6">
            <p className="type-body-medium text-ink-soft">No open profile reports.</p>
          </div>
        ) : (
          items.map((item) => (
            <ReportCard
              key={item.id}
              item={item}
              onDecision={onDecision}
              pending={pendingItemId === item.id}
            />
          ))
        )}
        {total > pageSize ? (
          <nav aria-label="Correction pages" className="flex items-center justify-between gap-3">
            <Button
              ariaLabel="Previous reports"
              disabled={offset === 0 || isLoading}
              onClick={() => {
                onPageChange(Math.max(0, offset - pageSize));
              }}
              size="sm"
              variant="secondary"
            >
              Previous
            </Button>
            <span className="type-body-small text-ink-soft">
              {offset + 1}–{Math.min(offset + pageSize, total)} of {total}
            </span>
            <Button
              ariaLabel="Next reports"
              disabled={offset + pageSize >= total || isLoading}
              onClick={() => {
                onPageChange(offset + pageSize);
              }}
              size="sm"
              variant="secondary"
            >
              Next
            </Button>
          </nav>
        ) : null}
      </section>
    </AdminPageShell>
  );
}

function ReportCard({
  item,
  onDecision,
  pending,
}: {
  item: CorrectionReport;
  onDecision: CorrectionInboxViewProps["onDecision"];
  pending: boolean;
}) {
  const profileUrl = publicProfileUrl(item);
  return (
    <article className="border-border bg-surface-container-lowest space-y-4 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="type-title-medium text-ink-strong">{item.entityName}</h3>
          <p className="type-body-small text-ink-soft">
            {item.reason.replaceAll("_", " ")} · {item.createdAt}
          </p>
          {profileUrl ? (
            <a className="type-label-medium text-accent hover:text-accent-ink" href={profileUrl}>
              Open {item.entityName}
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            ariaLabel={`Resolve ${item.entityName}`}
            disabled={pending}
            onClick={() => {
              onDecision(item.id, "resolve");
            }}
            size="sm"
          >
            Resolve
          </Button>
          <Button
            ariaLabel={`Dismiss ${item.entityName}`}
            disabled={pending}
            onClick={() => {
              onDecision(item.id, "dismiss");
            }}
            size="sm"
            variant="secondary"
          >
            Dismiss
          </Button>
        </div>
      </div>
      <div className="border-border bg-surface-container-low rounded-md border p-4">
        <p className="type-label-small text-ink-muted">Private reporter note</p>
        <p className="type-body-medium text-ink-strong mt-2 break-words whitespace-pre-wrap">
          {item.note || "No detail supplied."}
        </p>
      </div>
      <p className="type-body-small text-ink-soft">
        Resolve after the correction is complete. Dismiss if no change is warranted.
      </p>
    </article>
  );
}

function publicProfileUrl(item: CorrectionReport): string | null {
  if (!item.entitySlug) return null;
  if (item.entityType === "organization") {
    return `/profiles/organizations/${encodeURIComponent(item.entitySlug)}`;
  }
  if (item.entityType === "person") {
    return `/profiles/people/${encodeURIComponent(item.entitySlug)}`;
  }
  return null;
}
