import { Badge } from "@/platform/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/platform/ui/card";
import type { Entry } from "@/types";

interface EntryDetailProps {
  entry?: Entry;
  isLoading?: boolean;
  error?: Error | null;
  issueAreaLabels?: Record<string, string>;
}

function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

export function EntryDetail({
  entry,
  isLoading = false,
  error = null,
  issueAreaLabels = {},
}: EntryDetailProps) {
  if (isLoading) {
    return <p className="type-body-medium text-stone-500">Loading source-linked entry details…</p>;
  }

  if (error) {
    return <p className="type-body-medium text-red-700">{error.message}</p>;
  }

  if (!entry) {
    return <p className="type-body-medium text-stone-500">Entry not found.</p>;
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border-stone-200 bg-white shadow-sm">
        <CardHeader className="space-y-4 border-b-stone-200">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">{humanize(entry.type)}</Badge>
            {entry.verified ? (
              <Badge variant="success">Verified</Badge>
            ) : (
              <Badge>Source-linked</Badge>
            )}
            <Badge>{entry.source_count} sources</Badge>
          </div>
          <div className="space-y-2">
            <CardTitle className="type-headline-medium">{entry.name}</CardTitle>
            <p className="type-body-medium font-medium text-stone-500">{formatLocation(entry)}</p>
            {entry.full_address ? (
              <p className="type-body-medium text-stone-600">{entry.full_address}</p>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="type-body-large text-stone-700">{entry.description}</p>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <p className="type-label-medium text-stone-500 uppercase">Contact</p>
              <div className="type-body-medium space-y-1 text-stone-700">
                {entry.website ? (
                  <p>
                    <a
                      href={entry.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 hover:text-blue-800"
                    >
                      {entry.website}
                    </a>
                  </p>
                ) : null}
                {entry.email ? <p>{entry.email}</p> : null}
                {entry.phone ? <p>{entry.phone}</p> : null}
              </div>
            </div>

            <div className="space-y-2">
              <p className="type-label-medium text-stone-500 uppercase">Mention types</p>
              <div className="flex flex-wrap gap-2">
                {entry.source_types.map((sourceType) => (
                  <Badge key={sourceType}>{humanize(sourceType)}</Badge>
                ))}
              </div>
            </div>
          </div>

          {entry.issue_areas.length > 0 ? (
            <div className="space-y-2">
              <p className="type-label-medium text-stone-500 uppercase">Issue areas</p>
              <div className="flex flex-wrap gap-2">
                {entry.issue_areas.map((issueArea) => (
                  <Badge key={issueArea} variant="warning">
                    {issueAreaLabels[issueArea] ?? humanize(issueArea)}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-stone-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle>Source trail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {entry.sources?.length ? (
            entry.sources.map((source) => (
              <div key={source.id} className="rounded-2xl border border-stone-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{humanize(source.type)}</Badge>
                  {source.publication ? (
                    <span className="type-body-medium font-medium text-stone-700">
                      {source.publication}
                    </span>
                  ) : null}
                  {source.published_date ? (
                    <span className="type-body-medium text-stone-500">{source.published_date}</span>
                  ) : null}
                </div>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="type-title-large mt-3 block text-blue-700 hover:text-blue-800"
                >
                  {source.title ?? source.url}
                </a>
                {source.extraction_context ? (
                  <p className="type-body-medium mt-3 text-stone-600">
                    {source.extraction_context}
                  </p>
                ) : null}
              </div>
            ))
          ) : (
            <p className="type-body-medium text-stone-500">No linked sources yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
