import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { EntryDetail } from "@/domains/catalog/components/entries/entry-detail";
import { PersonProfile } from "@/domains/catalog/components/profiles/person-profile";
import { useEntry } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { PageLayout } from "@/platform/layout/page-layout";

/**
 * Renders the catalog entry detail view for a specific entry identifier.
 */
export function EntryPage({ entryId }: { entryId: string }) {
  const entryQuery = useEntry(entryId);
  const taxonomyQuery = useTaxonomy();
  const entry = entryQuery.data;

  const affiliatedOrgQuery = useEntry(entry?.affiliated_org_id ?? "", {
    enabled: !!entry?.affiliated_org_id,
  });

  const issueAreaLabels = Object.fromEntries(
    Object.values(taxonomyQuery.data ?? {})
      .flat()
      .map((issue) => [issue.slug, issue.name]),
  );

  if (entryQuery.isLoading) {
    return (
      <PageLayout className="space-y-6 py-10">
        <Link
          to="/"
          className="type-label-large inline-flex items-center gap-2 font-medium text-stone-600 transition-colors hover:text-stone-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the Atlas
        </Link>
        <p className="type-body-medium text-stone-500">Loading source-linked entry details...</p>
      </PageLayout>
    );
  }

  if (entryQuery.error) {
    return (
      <PageLayout className="space-y-6 py-10">
        <Link
          to="/"
          className="type-label-large inline-flex items-center gap-2 font-medium text-stone-600 transition-colors hover:text-stone-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the Atlas
        </Link>
        <p className="type-body-medium text-red-700">{entryQuery.error.message}</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout className="space-y-6 py-10">
      <Link
        to="/"
        className="type-label-large inline-flex items-center gap-2 font-medium text-stone-600 transition-colors hover:text-stone-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to the Atlas
      </Link>

      {entry?.type === "person" ? (
        <PersonProfile
          entry={entry}
          issueAreaLabels={issueAreaLabels}
          affiliatedOrg={affiliatedOrgQuery.data}
        />
      ) : (
        <EntryDetail
          entry={entry}
          isLoading={entryQuery.isLoading}
          error={entryQuery.error}
          issueAreaLabels={issueAreaLabels}
        />
      )}
    </PageLayout>
  );
}
