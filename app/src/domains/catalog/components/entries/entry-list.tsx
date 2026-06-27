import { AlertCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { EntryCard } from "@/domains/catalog/components/entries/entry-card";
import { Button } from "@/platform/ui/button";
import { Spinner } from "@/platform/ui/spinner";
import type { Entry } from "@/types";

interface EntryListProps {
  entries: Entry[];
  total?: number;
  isLoading?: boolean;
  error?: Error | null;
  issueAreaLabels?: Record<string, string>;
  hasActiveSearch?: boolean;
  resultLabelPlural?: string;
  emptyAction?: {
    label: string;
    to: "/browse" | "/discovery" | "/profiles";
  };
}

function emptyHeading(resultLabelPlural: string, hasActiveSearch: boolean): string {
  if (resultLabelPlural === "entries") {
    return hasActiveSearch ? "No matching civic actors." : "No civic actors listed.";
  }

  return hasActiveSearch ? `No matching ${resultLabelPlural}.` : `No ${resultLabelPlural} listed.`;
}

function emptyDescription(hasActiveSearch: boolean): string {
  if (hasActiveSearch) {
    return "Try fewer filters, a broader place, or a different issue.";
  }

  return "Start research to find source-backed people, organizations, initiatives, and public mentions.";
}

function resultSummary(total: number, resultLabelPlural: string): string {
  if (total === 1 && resultLabelPlural === "entries") {
    return "1 matched entry";
  }

  return `${total} matched ${resultLabelPlural}`;
}

export function EntryList({
  entries,
  total,
  isLoading = false,
  error = null,
  issueAreaLabels = {},
  hasActiveSearch = false,
  resultLabelPlural = "entries",
  emptyAction = { label: "Research", to: "/discovery" },
}: EntryListProps) {
  if (isLoading) {
    return (
      <div className="bg-surface-container-lowest rounded-[1.4rem] px-4 py-12">
        <Spinner />
        <p className="type-body-medium text-ink-muted mt-4 text-center">Loading</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[1.4rem] bg-red-50 px-4 py-6 text-red-800">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-5 w-5" />
          Search unavailable
        </div>
        <p className="type-body-medium mt-2">{error.message}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="bg-surface-container-lowest rounded-[1.6rem] px-4 py-12 text-center">
        <p className="type-title-large text-ink-strong">
          {emptyHeading(resultLabelPlural, hasActiveSearch)}
        </p>
        <p className="type-body-medium text-ink-muted mt-2">{emptyDescription(hasActiveSearch)}</p>
        {!hasActiveSearch ? (
          <div className="mt-5 flex justify-center">
            <Link to={emptyAction.to}>
              <Button>{emptyAction.label}</Button>
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {typeof total === "number" ? (
        <p className="type-body-medium bg-surface-container-lowest text-ink-muted rounded-[1rem] px-3 py-2 font-medium">
          {resultSummary(total, resultLabelPlural)}
        </p>
      ) : null}
      {entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} issueAreaLabels={issueAreaLabels} />
      ))}
    </div>
  );
}
