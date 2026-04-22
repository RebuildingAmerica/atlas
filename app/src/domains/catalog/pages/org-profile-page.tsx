/**
 * Full-page layout for organization profiles.
 *
 * Renders in a centered container with a two-column layout on desktop:
 * main column for the profile card, sidebar for connections. Accepts
 * server-loaded entry data so the page can be fully SSR'd.
 */
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { OrgProfile } from "@/domains/catalog/components/profiles/org-profile";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { PageLayout } from "@/platform/layout/page-layout";
import type { Entry } from "@/types";

interface OrgProfilePageProps {
  /** The organization entry, loaded server-side by the route loader. */
  entry: Entry;
}

export function OrgProfilePage({ entry }: OrgProfilePageProps) {
  const taxonomyQuery = useTaxonomy();

  // Fetch people affiliated with this org.
  // NOTE: The API does not yet support filtering by affiliated_org_id.
  // When that filter is added to ListEntitiesParams, pass it here to get
  // server-side filtering instead of an empty result.
  const affiliatedPeopleQuery = useEntries({ entry_types: ["person"], limit: 50 });
  const affiliatedPeople = (affiliatedPeopleQuery.data?.data ?? []).filter(
    (p) => p.affiliated_org_id === entry.id,
  );

  const issueAreaLabels = Object.fromEntries(
    Object.values(taxonomyQuery.data ?? {})
      .flat()
      .map((issue) => [issue.slug, issue.name]),
  );

  return (
    <PageLayout className="space-y-6 py-10">
      <Link
        to="/browse"
        className="type-label-large inline-flex items-center gap-2 font-medium text-stone-600 transition-colors hover:text-stone-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to the Atlas
      </Link>

      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-[3]">
          <OrgProfile
            entry={entry}
            issueAreaLabels={issueAreaLabels}
            affiliatedPeople={affiliatedPeople}
          />
        </div>
        <aside className="flex-[2] lg:max-w-sm">{/* Connections section added in Task 8 */}</aside>
      </div>
    </PageLayout>
  );
}
