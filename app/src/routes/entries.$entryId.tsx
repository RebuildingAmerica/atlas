import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { EntryDetail } from "@/components/entries/entry-detail";
import { PageLayout } from "@/components/layout/page-layout";
import { useEntry } from "@/hooks/use-entries";
import { useTaxonomy } from "@/hooks/use-taxonomy";

export const Route = createFileRoute("/entries/$entryId")({
  ssr: false,
  component: EntryPage,
});

function EntryPage() {
  const { entryId } = Route.useParams();
  const entryQuery = useEntry(entryId);
  const taxonomyQuery = useTaxonomy();

  const issueAreaLabels = Object.fromEntries(
    Object.values(taxonomyQuery.data ?? {})
      .flat()
      .map((issue) => [issue.slug, issue.name]),
  );

  return (
    <PageLayout className="space-y-6 py-10">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm font-medium text-stone-600 transition-colors hover:text-stone-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to the Atlas
      </Link>

      <EntryDetail
        entry={entryQuery.data}
        isLoading={entryQuery.isLoading}
        error={entryQuery.error}
        issueAreaLabels={issueAreaLabels}
      />
    </PageLayout>
  );
}
