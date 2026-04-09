import { AlertCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { EntryCard } from "@/components/entries/entry-card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Entry } from "@/types";

interface EntryListProps {
  entries: Entry[];
  total?: number;
  isLoading?: boolean;
  error?: Error | null;
  issueAreaLabels?: Record<string, string>;
  hasActiveSearch?: boolean;
}

export function EntryList({
  entries,
  total,
  isLoading = false,
  error = null,
  issueAreaLabels = {},
  hasActiveSearch = false,
}: EntryListProps) {
  if (isLoading) {
    return (
      <div className="rounded-3xl border border-stone-200 bg-white p-12">
        <Spinner />
        <p className="mt-4 text-center text-sm text-stone-500">
          Searching the Atlas for people and organizations doing the work.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-5 w-5" />
          Search unavailable
        </div>
        <p className="mt-2 text-sm">{error.message}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-[2rem] border border-dashed border-stone-300 bg-white p-12 text-center">
        <p className="text-lg font-semibold text-stone-900">
          {hasActiveSearch ? "No matching civic actors yet." : "Atlas has no civic actors yet."}
        </p>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          {hasActiveSearch
            ? "Try broadening geography or source filters, or search by a specific person, organization, or issue."
            : "Run a discovery pass to seed the directory with people, organizations, initiatives, and source-linked mentions."}
        </p>
        {!hasActiveSearch ? (
          <div className="mt-5 flex justify-center">
            <Link to="/discovery">
              <Button>Open discovery</Button>
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {typeof total === "number" ? (
        <p className="text-sm font-medium text-stone-500">{total} matched entries</p>
      ) : null}
      {entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} issueAreaLabels={issueAreaLabels} />
      ))}
    </div>
  );
}
