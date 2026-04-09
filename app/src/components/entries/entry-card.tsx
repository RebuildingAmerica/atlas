import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Entry } from "@/types";

interface EntryCardProps {
  entry: Entry;
  issueAreaLabels?: Record<string, string>;
}

function formatLocation(entry: Entry): string {
  if (entry.city && entry.state) {
    return `${entry.city}, ${entry.state}`;
  }
  if (entry.region) {
    return entry.region;
  }
  return entry.state ?? "Location not specified";
}

function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function EntryCard({ entry, issueAreaLabels = {} }: EntryCardProps) {
  return (
    <Card className="border-stone-200 bg-white/95 p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">{humanize(entry.type)}</Badge>
              {entry.verified ? <Badge variant="success">Verified</Badge> : null}
              <Badge>{entry.source_count} sources</Badge>
            </div>
            <div>
              <Link
                to="/entries/$entryId"
                params={{ entryId: entry.id }}
                className="text-xl font-semibold text-stone-900 transition-colors hover:text-blue-700"
              >
                {entry.name}
              </Link>
              <p className="mt-1 text-sm font-medium text-stone-500">{formatLocation(entry)}</p>
            </div>
          </div>

          {entry.latest_source_date ? (
            <p className="text-sm text-stone-500">Latest source: {entry.latest_source_date}</p>
          ) : null}
        </div>

        <p className="text-sm leading-6 text-stone-700">{entry.description}</p>

        {entry.issue_areas.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {entry.issue_areas.slice(0, 4).map((issueArea) => (
              <Badge key={issueArea} variant="warning">
                {issueAreaLabels[issueArea] ?? humanize(issueArea)}
              </Badge>
            ))}
          </div>
        ) : null}

        {entry.source_types.length > 0 ? (
          <div className="flex flex-wrap gap-2 text-sm text-stone-500">
            <span className="font-medium text-stone-700">Mentioned in</span>
            {entry.source_types.slice(0, 4).map((sourceType) => (
              <span key={sourceType} className="rounded-full bg-stone-100 px-2.5 py-1">
                {humanize(sourceType)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
