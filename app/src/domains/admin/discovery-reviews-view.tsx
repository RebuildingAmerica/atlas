import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { useState } from "react";
import {
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
} from "./admin-portal";
import type { DiscoveryReview } from "./discovery-reviews.functions";

type ReviewDecision = "approve" | "reject";

interface DiscoveryReviewsViewProps {
  decisionError?: string;
  errorMessage?: string;
  isLoading: boolean;
  items: DiscoveryReview[];
  offset: number;
  onDecision: (itemId: string, decision: ReviewDecision) => void;
  onPageChange: (offset: number) => void;
  pageSize: number;
  pendingItemId?: string;
  total: number;
}

export function DiscoveryReviewsView({
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
}: DiscoveryReviewsViewProps) {
  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Editorial review"
        title="Discovered profiles"
        description="Compare proposed facts with the current profile and check the cited sources before publishing."
      />
      <section className="space-y-4" aria-label="Pending discovery reviews">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="type-title-large text-ink-strong">Waiting for review</h2>
          <span className="type-body-small text-ink-soft">{total} pending</span>
        </div>
        <AdminInlineStatus message={errorMessage} />
        <AdminInlineStatus message={decisionError} />
        {isLoading ? (
          <div
            className="border-border bg-surface-container-lowest h-24 rounded-lg border"
            aria-busy
          />
        ) : items.length === 0 && !errorMessage ? (
          <div className="border-border bg-surface-container-lowest rounded-lg border p-6">
            <p className="type-body-medium text-ink-soft">No discovery profiles waiting.</p>
          </div>
        ) : (
          items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              onDecision={onDecision}
              pending={pendingItemId === item.id}
            />
          ))
        )}
        {total > pageSize ? (
          <nav className="flex items-center justify-between gap-3" aria-label="Review pages">
            <Button
              ariaLabel="Previous reviews"
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
              ariaLabel="Next reviews"
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

function ReviewCard({
  item,
  onDecision,
  pending,
}: {
  item: DiscoveryReview;
  onDecision: DiscoveryReviewsViewProps["onDecision"];
  pending: boolean;
}) {
  const sources = item.sourceUrls.map(safeSourceUrl).filter(isPresent);
  const changes = item.changes;
  const profileUrl = changes.length > 0 ? publicProfileUrl(item) : null;
  const name = item.entityName;
  const [sourcesChecked, setSourcesChecked] = useState(false);

  return (
    <article className="border-border bg-surface-container-lowest space-y-5 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="type-title-large text-ink-strong">{name}</h3>
            <AdminStatusBadge tone="warn" compact>
              {changes.length > 0 ? "Proposed edit" : "Publication hold"}
            </AdminStatusBadge>
          </div>
          <p className="type-body-small text-ink-soft">{readableReason(item.holdReason)}</p>
          {profileUrl ? (
            <a className="type-label-medium text-accent hover:text-accent-ink" href={profileUrl}>
              Open current profile
            </a>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            ariaLabel={`Approve ${name}`}
            disabled={pending || sources.length === 0 || !sourcesChecked}
            onClick={() => {
              onDecision(item.id, "approve");
            }}
            size="sm"
          >
            Approve
          </Button>
          <Button
            ariaLabel={`Reject ${name}`}
            disabled={pending}
            onClick={() => {
              onDecision(item.id, "reject");
            }}
            size="sm"
            variant="secondary"
          >
            Reject
          </Button>
        </div>
      </div>

      {changes.length > 0 ? (
        <section className="space-y-3" aria-label={`Proposed changes for ${name}`}>
          <h4 className="type-label-medium text-ink-strong">Proposed changes</h4>
          <dl className="grid gap-3">
            {changes.map((change) => (
              <div
                className="border-border grid gap-2 rounded-md border p-3 sm:grid-cols-2"
                key={change.field}
              >
                <div>
                  <dt className="type-label-small text-ink-muted">
                    Current {readableReason(change.field)}
                  </dt>
                  <dd className="type-body-small text-ink-strong mt-1 break-words">
                    {change.before}
                  </dd>
                </div>
                <div>
                  <dt className="type-label-small text-ink-muted">
                    Proposed {readableReason(change.field)}
                  </dt>
                  <dd className="type-body-small text-ink-strong mt-1 break-words">
                    {change.after}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="space-y-2" aria-label={`Candidate sources for ${name}`}>
        <h4 className="type-label-medium text-ink-strong">Candidate sources</h4>
        {sources.length > 0 ? (
          <ul className="space-y-1">
            {sources.map((source) => (
              <li key={source}>
                <a
                  className="type-body-small text-accent hover:text-accent-ink break-all"
                  href={source}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {source}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-body-small text-ink-soft">
            No source link attached. Reject this item and research the profile before submitting it
            again.
          </p>
        )}
        {sources.length > 0 ? (
          <label className="type-body-small text-ink-strong flex items-start gap-2 pt-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={sourcesChecked}
              onChange={(event) => {
                setSourcesChecked(event.target.checked);
              }}
            />
            I checked these sources against the proposed facts.
          </label>
        ) : null}
      </section>
    </article>
  );
}

function safeSourceUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function publicProfileUrl(item: DiscoveryReview): string | null {
  if (!item.entitySlug) return null;
  if (item.entityType === "person")
    return `/profiles/people/${encodeURIComponent(item.entitySlug)}`;
  if (item.entityType === "organization") {
    return `/profiles/organizations/${encodeURIComponent(item.entitySlug)}`;
  }
  return null;
}

function readableReason(value: string): string {
  return value.replaceAll("_", " ");
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
