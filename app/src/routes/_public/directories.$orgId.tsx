import { createFileRoute } from "@tanstack/react-router";
import { GitBranch } from "lucide-react";
import { loadPublicDirectory } from "@/domains/catalog/server/public-directory";

export const Route = createFileRoute("/_public/directories/$orgId")({
  loader: async ({ params }) => {
    const directory = await loadPublicDirectory({ data: { orgId: params.orgId } });
    return { directory };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.directory.workspace.name ?? "Workspace"} Directory | Atlas`,
      },
      {
        name: "description",
        content: "A source-linked public civic directory powered by Atlas.",
      },
    ],
  }),
  component: PublicDirectoryPage,
});

function PublicDirectoryPage() {
  const { directory } = Route.useLoaderData();
  const entryCount = directory.entries.length;
  const verifiedDomainLabel = directory.workspace.custom_domain
    ? `Verified domain: ${directory.workspace.custom_domain.domain}`
    : null;

  return (
    <div className="bg-page-bg">
      <section className="border-border bg-surface-container-low border-b px-6 py-10">
        <div className="mx-auto max-w-5xl space-y-4">
          <p className="type-label-medium text-ink-muted tracking-wider uppercase">
            Public directory
          </p>
          <div className="space-y-3">
            <h1 className="type-display-small text-ink-strong">{directory.workspace.name}</h1>
            <p className="type-body-large text-ink-soft max-w-3xl">
              Source-linked actors, profiles, and public evidence published from this workspace.
            </p>
          </div>
          <p className="type-label-large text-ink-soft">
            {entryCount} {entryCount === 1 ? "profile" : "profiles"}
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 py-8">
        {directory.entries.length > 0 ? (
          directory.entries.map((entry) => (
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
            </article>
          ))
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

function profileHref(entry: { slug: string; type: string }): string {
  if (entry.type === "person") {
    return `/profiles/people/${entry.slug}`;
  }
  if (entry.type === "organization") {
    return `/profiles/organizations/${entry.slug}`;
  }
  return `/profiles/${entry.type}s/${entry.slug}`;
}
