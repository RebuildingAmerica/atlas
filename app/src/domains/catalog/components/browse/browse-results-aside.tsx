import { EntryList } from "@/domains/catalog/components/entries/entry-list";
import { Button } from "@/platform/ui/button";
import type { BrowseFilterKey } from "@/domains/catalog/search-state";
import type { BrowsePageContent } from "./browse-page-content";
import type { Entry } from "@/types";

interface RemovableBadge {
  key: BrowseFilterKey;
  label: string;
  value: string;
}

interface PaginationState {
  has_more: boolean;
  limit: number;
  offset: number;
  total: number;
}

export interface BrowseResearchContext {
  chips: string[];
  query?: string;
}

export interface BrowsePlaceBrief {
  body: string;
  signal?: string;
  title: string;
}

export interface BrowseIssueBrief {
  body: string;
  gap?: string;
  signal?: string;
  title: string;
}

interface BrowseResultsAsideProps {
  emptyAction: BrowsePageContent["emptyAction"];
  entries: Entry[];
  error: Error | null | undefined;
  hasActiveSearch: boolean;
  isLoading: boolean;
  issueAreaLabels: Record<string, string>;
  issueBrief: BrowseIssueBrief | undefined;
  pagination: PaginationState | undefined;
  removableBadges: RemovableBadge[];
  placeBrief: BrowsePlaceBrief | undefined;
  researchContext: BrowseResearchContext | undefined;
  resultLabelPlural: string | undefined;
  resultsHeading: string | undefined;
  onPageChange: (offset: number) => void;
  onToggleFilter: (key: BrowseFilterKey, value: string) => void;
}

/**
 * Right-rail aside that lists the active result entries: removable
 * filter badges across the top, the entry list itself, and the
 * Previous / Next paginator with the "Showing N-M of total" line.
 */
export function BrowseResultsAside({
  emptyAction,
  entries,
  error,
  hasActiveSearch,
  isLoading,
  issueAreaLabels,
  issueBrief,
  pagination,
  placeBrief,
  removableBadges,
  researchContext,
  resultLabelPlural,
  resultsHeading,
  onPageChange,
  onToggleFilter,
}: BrowseResultsAsideProps) {
  return (
    <aside className="min-w-0 lg:pt-0">
      <div className="bg-surface-container-high overflow-hidden rounded-[1.45rem] lg:sticky lg:top-20">
        <div className="px-3 pt-3 lg:px-4 lg:pt-4">
          <p className="type-label-small text-ink-muted uppercase">Results</p>
          <h2 className="type-headline-small text-ink-strong mt-2">{resultsHeading}</h2>
        </div>

        <div className="px-3 pb-3 lg:px-4 lg:pb-4">
          {researchContext ? (
            <div className="border-border bg-surface-container-lowest mb-3 space-y-2 rounded-[1rem] border px-3 py-2.5">
              <div>
                <p className="type-label-small text-ink-muted uppercase">Research focus</p>
                {researchContext.query ? (
                  <p className="type-title-medium text-ink-strong mt-1">{researchContext.query}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {researchContext.chips.map((chip) => (
                  <span
                    key={chip}
                    className="type-label-large bg-surface-container-high text-ink-soft rounded-full px-2.5 py-1"
                  >
                    {chip}
                  </span>
                ))}
              </div>
              <p className="type-body-small text-ink-muted">
                Prioritize records with deeper source trails and recent coverage.
              </p>
            </div>
          ) : null}

          {placeBrief ? (
            <div className="border-border bg-surface-container-lowest mb-3 space-y-2 rounded-[1rem] border px-3 py-2.5">
              <p className="type-label-small text-ink-muted uppercase">Place brief</p>
              <p className="type-title-medium text-ink-strong">{placeBrief.title}</p>
              <p className="type-body-small text-ink-soft">{placeBrief.body}</p>
              {placeBrief.signal ? (
                <p className="type-body-small text-ink-muted">{placeBrief.signal}</p>
              ) : null}
            </div>
          ) : null}

          {issueBrief ? (
            <div className="border-border bg-surface-container-lowest mb-3 space-y-2 rounded-[1rem] border px-3 py-2.5">
              <p className="type-label-small text-ink-muted uppercase">Issue brief</p>
              <p className="type-title-medium text-ink-strong">{issueBrief.title}</p>
              <p className="type-body-small text-ink-soft">{issueBrief.body}</p>
              {issueBrief.signal ? (
                <p className="type-body-small text-ink-muted">{issueBrief.signal}</p>
              ) : null}
              {issueBrief.gap ? (
                <p className="type-body-small text-ink-muted">{issueBrief.gap}</p>
              ) : null}
            </div>
          ) : null}

          {removableBadges.length > 0 ? (
            <div className="flex flex-wrap gap-x-2.5 gap-y-1.5">
              {removableBadges.map((badge) => (
                <button
                  key={`${badge.key}:${badge.value}`}
                  type="button"
                  onClick={() => {
                    onToggleFilter(badge.key, badge.value);
                  }}
                  className="type-label-large bg-surface-container-lowest text-ink-soft hover:text-ink-strong rounded-full px-2.5 py-1 transition-colors"
                >
                  {badge.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <EntryList
          entries={entries}
          total={pagination?.total}
          isLoading={isLoading}
          error={error}
          issueAreaLabels={issueAreaLabels}
          hasActiveSearch={hasActiveSearch}
          resultLabelPlural={resultLabelPlural}
          emptyAction={emptyAction}
        />

        {pagination?.total ? (
          <div className="bg-surface-container-lowest flex flex-col gap-2 rounded-[1rem] p-2.5 lg:flex-row lg:items-center lg:justify-between">
            <p className="type-body-medium text-ink-muted">
              Showing {pagination.offset + 1}-
              {Math.min(pagination.offset + pagination.limit, pagination.total)} of{" "}
              {pagination.total}
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                disabled={pagination.offset === 0}
                onClick={() => {
                  onPageChange(Math.max(0, pagination.offset - pagination.limit));
                }}
              >
                Previous
              </Button>
              <Button
                disabled={!pagination.has_more}
                onClick={() => {
                  onPageChange(pagination.offset + pagination.limit);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
