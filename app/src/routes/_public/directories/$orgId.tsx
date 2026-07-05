import { createFileRoute } from "@tanstack/react-router";
import { GitBranch, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { loadPublicDirectory } from "@/domains/catalog/server/public-directory";
import { buildPageHead } from "@/platform/seo";
import type { Entry } from "@/types";

export const Route = createFileRoute("/_public/directories/$orgId")({
  loader: async ({ params }) => {
    const directory = await loadPublicDirectory({ data: { orgId: params.orgId } });
    return { directory };
  },
  head: ({ loaderData, params }) => {
    const directory = loaderData?.directory;
    if (!directory) return {};

    return buildPageHead({
      title: `${directory.title} | Atlas`,
      description: "A source-linked public civic directory.",
      path: `/directories/${params.orgId}`,
    });
  },
  component: PublicDirectoryPage,
});

function PublicDirectoryPage() {
  const { directory } = Route.useLoaderData();
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const entryCount = directory.stats.record_count;
  const verifiedDomainLabel = directory.workspace.custom_domain
    ? `Verified domain: ${directory.workspace.custom_domain.domain}`
    : null;
  const scopeLabels = [
    ...directory.scope.geography_labels,
    ...directory.scope.issue_area_ids.map(titleCaseIdentifier),
    ...directory.scope.entry_types.map(titleCaseIdentifier),
  ];
  const visibleEntries = useMemo(
    () => directory.entries.filter((entry) => directoryEntryMatchesSearch(entry, normalizedSearch)),
    [directory.entries, normalizedSearch],
  );

  return (
    <div className="bg-page-bg">
      <section className="border-border bg-surface-container-low border-b px-6 py-10">
        <div className="mx-auto max-w-5xl space-y-4">
          <p className="type-label-medium text-ink-muted tracking-wider uppercase">
            Public directory
          </p>
          <div className="space-y-3">
            <h1 className="type-display-small text-ink-strong">{directory.title}</h1>
            {directory.sponsor_label ? (
              <p className="type-label-large text-ink-soft">{directory.sponsor_label}</p>
            ) : null}
            <p className="type-body-large text-ink-soft max-w-3xl">
              Source-linked actors, profiles, and public evidence.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {scopeLabels.map((label) => (
              <span
                key={label}
                className="type-label-medium bg-surface-container text-ink-soft rounded-full px-3 py-1"
              >
                {label}
              </span>
            ))}
          </div>
          <dl className="grid gap-4 pt-2 sm:grid-cols-4">
            <div>
              <dt className="type-label-small text-ink-muted">Profiles</dt>
              <dd className="type-title-small text-ink-strong">
                {countLabel(entryCount, "public profile")}
              </dd>
            </div>
            <div>
              <dt className="type-label-small text-ink-muted">Sources</dt>
              <dd className="type-title-small text-ink-strong">
                {countLabel(directory.stats.source_count, "source")}
              </dd>
            </div>
            <div>
              <dt className="type-label-small text-ink-muted">Source-backed</dt>
              <dd className="type-title-small text-ink-strong">
                {countLabel(directory.stats.source_backed_record_count, "record")}
              </dd>
            </div>
            <div>
              <dt className="type-label-small text-ink-muted">Review</dt>
              <dd className="type-title-small text-ink-strong">
                {directory.stats.last_reviewed_at
                  ? `Last reviewed ${formatDirectoryDate(directory.stats.last_reviewed_at)}`
                  : "No review date"}
              </dd>
            </div>
          </dl>
          {!directory.publication.private_notes_exposed ? (
            <p className="type-body-small text-ink-soft">Private workspace notes are not public.</p>
          ) : null}
        </div>
      </section>

      <section
        aria-label="Methodology"
        className="border-border bg-surface-container-lowest border-b px-6 py-6"
      >
        <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <p className="type-label-small text-ink-muted tracking-widest uppercase">Methodology</p>
            <h2 className="type-title-large text-ink-strong mt-2">
              {directory.methodology.summary}
            </h2>
          </div>
          <dl className="grid gap-3">
            <div>
              <dt className="type-label-small text-ink-muted">Sources</dt>
              <dd className="type-body-small text-ink-strong">
                {directory.methodology.source_policy}
              </dd>
            </div>
            <div>
              <dt className="type-label-small text-ink-muted">Review</dt>
              <dd className="type-body-small text-ink-strong">
                {directory.methodology.review_policy}
              </dd>
            </div>
            <div>
              <dt className="type-label-small text-ink-muted">Corrections</dt>
              <dd className="type-body-small text-ink-strong">
                {directory.methodology.correction_policy}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-8">
        {directory.entries.length > 0 ? (
          <div className="grid gap-3">
            <label className="grid max-w-xl gap-2">
              <span className="type-label-medium text-ink-strong">Search directory</span>
              <span className="relative">
                <Search
                  className="text-ink-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                  aria-hidden
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                  }}
                  className="border-border bg-surface-container-lowest text-ink-strong placeholder:text-ink-muted focus:border-civic w-full border py-2 pr-3 pl-9 outline-none"
                  placeholder="Name, issue, place, or source"
                />
              </span>
            </label>
            {normalizedSearch ? (
              <p className="type-label-medium text-ink-soft">
                {countLabel(visibleEntries.length, "matching profile")}
              </p>
            ) : null}
          </div>
        ) : null}

        {visibleEntries.length > 0 ? (
          visibleEntries.map((entry) => (
            <article
              key={entry.id}
              className="border-border bg-surface-container-lowest grid gap-4 border p-5 md:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="type-title-large text-ink-strong">{entry.name}</h2>
                  <span className="type-label-medium border-border text-ink-muted rounded-full border px-2 py-0.5">
                    {entry.type}
                  </span>
                </div>
                <p className="type-body-medium text-ink-soft">{entry.description}</p>
                <div className="flex flex-wrap gap-2">
                  <span className="type-label-medium bg-surface-container text-ink-soft rounded-full px-3 py-1">
                    {entry.source_count} {entry.source_count === 1 ? "source" : "sources"}
                  </span>
                  <span className="type-label-medium bg-surface-container text-ink-soft rounded-full px-3 py-1">
                    {entry.claim_evidence?.summary?.confidence ?? "unverified"}
                  </span>
                </div>
              </div>
              <a
                href={profileHref(entry)}
                className="type-label-large text-primary hover:text-on-primary-container self-start"
              >
                Open profile
              </a>
              <div className="flex flex-wrap gap-3 md:col-span-2">
                <a
                  href={`/feedback/${entry.slug}?kind=incorrect`}
                  className="type-label-medium text-civic hover:text-civic-deep underline-offset-2 hover:underline"
                >
                  Report stale or incorrect information
                </a>
                <a
                  href={`/feedback/${entry.slug}?kind=missing_context`}
                  className="type-label-medium text-civic hover:text-civic-deep underline-offset-2 hover:underline"
                >
                  Suggest missing context
                </a>
              </div>
            </article>
          ))
        ) : normalizedSearch ? (
          <p className="type-body-medium text-ink-muted">No matching public profiles.</p>
        ) : (
          <p className="type-body-medium text-ink-muted">No public profiles listed yet.</p>
        )}
      </section>

      {directory.federation ? (
        <section
          aria-label="Commons exchange"
          className="bg-paper border-border mx-auto max-w-5xl border-y px-6 py-6"
        >
          <div className="grid gap-5 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <div className="border-civic/50 border-l-[3px] pl-4">
              <div className="flex items-center gap-2">
                <GitBranch className="text-civic h-4 w-4" aria-hidden />
                <p className="type-label-small text-ink-muted tracking-widest uppercase">
                  Commons exchange
                </p>
              </div>
              <h2 className="type-title-large text-ink-strong mt-2">
                {directory.federation.label}
              </h2>
              <p className="type-body-small text-ink-soft mt-2 leading-relaxed">
                {directory.federation.body}
              </p>
            </div>
            <div className="space-y-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <dt className="type-label-small text-ink-muted">Shared</dt>
                  <dd className="type-title-small text-ink-strong font-semibold">
                    {countLabel(directory.federation.shared_record_count, "shared record")}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="type-label-small text-ink-muted">Source-backed</dt>
                  <dd className="type-title-small text-ink-strong font-semibold">
                    {countLabel(
                      directory.federation.source_backed_record_count,
                      "source-backed record",
                    )}
                  </dd>
                </div>
              </dl>

              <div className="border-border/80 border-t pt-4">
                <p className="type-label-small text-ink-muted tracking-widest uppercase">Policy</p>
                <dl className="mt-3 grid gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <dt className="type-label-small text-ink-muted">Gate</dt>
                    <dd className="type-body-small text-ink-strong">
                      {directory.federation.review_required ? "Review required" : "Open reuse"}
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <dt className="type-label-small text-ink-muted">Status</dt>
                    <dd className="type-body-small text-ink-strong">
                      {federationStatusLabel(directory.federation.status)}
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <dt className="type-label-small text-ink-muted">Minimum confidence</dt>
                    <dd className="type-body-small text-ink-strong">
                      {sentenceCase(directory.federation.minimum_confidence)}
                    </dd>
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <dt className="type-label-small text-ink-muted">Ingestion</dt>
                    <dd className="type-body-small text-ink-strong">
                      {directory.federation.provenance_stamped_ingestion
                        ? "Provenance-stamped ingestion"
                        : "Unstamped ingestion"}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="border-border bg-surface-container border-t px-6 py-6">
        <div className="mx-auto max-w-5xl">
          <p className="type-label-large text-ink-strong">{directory.trust_footer.label}</p>
          {verifiedDomainLabel ? (
            <p className="type-label-small text-ink-muted mt-1">{verifiedDomainLabel}</p>
          ) : null}
          <p className="type-body-small text-ink-soft mt-1">{directory.trust_footer.body}</p>
        </div>
      </section>
    </div>
  );
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function federationStatusLabel(status: string): string {
  return sentenceCase(status.replaceAll("_", " "));
}

function sentenceCase(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function titleCaseIdentifier(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDirectoryDate(value: string): string {
  const [yearText, monthText, dayText] = value.slice(0, 10).split("-");
  if (!yearText || !monthText || !dayText) {
    return value;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return value;
  }
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function directoryEntryMatchesSearch(entry: Entry, query: string): boolean {
  if (!query) {
    return true;
  }

  const searchableText = [
    entry.name,
    entry.description,
    entry.type,
    entry.city,
    entry.state,
    entry.region,
    ...(entry.issue_areas ?? []),
    ...(entry.source_types ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return searchableText.includes(query);
}

function profileHref(entry: { slug: string; type: string }): string {
  if (entry.type === "person") {
    return `/profiles/people/${entry.slug}`;
  }
  if (entry.type === "organization") {
    return `/profiles/organizations/${entry.slug}`;
  }
  return `/profiles/${entry.type}s/${entry.slug}`;
}
