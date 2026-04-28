import { useMemo } from "react";
import {
  PROFILE_SHOWCASE_ICONS,
  ProfilesEmptyState,
  ProfilesFreshList,
  ProfilesIssueLandscape,
  ProfilesMarquee,
  ProfilesShowcaseHeader,
  ProfilesShelf,
  type IssueLandscapeGroup,
} from "@/domains/catalog/components/profiles/profile-showcase";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import {
  lockedEntryTypesForScope,
  type ProfileBrowseScope,
} from "@/domains/catalog/profile-browse";
import { PageLayout } from "@/platform/layout/page-layout";
import type { Entry, EntryListResponse } from "@/types";

interface ProfilesOverviewPageProps {
  scope?: ProfileBrowseScope;
  /**
   * Server-rendered catalog slice — present when the route loader supplied
   * one. Threaded into `useEntries` as `initialData` so the marquee renders
   * immediately on first paint.
   */
  initialCatalog?: EntryListResponse;
}

function buildIssueAreaLabels(
  taxonomy: ReturnType<typeof useTaxonomy>["data"],
): Record<string, string> {
  const labels: Record<string, string> = {};

  Object.values(taxonomy ?? {}).forEach((issues) => {
    issues.forEach((issue) => {
      labels[issue.slug] = issue.name;
    });
  });

  return labels;
}

function sortByFreshness(entries: Entry[]): Entry[] {
  return [...entries].sort((left, right) => {
    const leftValue = new Date(
      left.latest_source_date ?? left.updated_at ?? left.created_at,
    ).getTime();
    const rightValue = new Date(
      right.latest_source_date ?? right.updated_at ?? right.created_at,
    ).getTime();

    return rightValue - leftValue;
  });
}

function dedupeEntries(entries: Entry[]): Entry[] {
  const seen = new Set<string>();

  return entries.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }

    seen.add(entry.id);
    return true;
  });
}

function buildIssueLandscapeGroups(
  entries: Entry[],
  issueAreaLabels: Record<string, string>,
): IssueLandscapeGroup[] {
  const counts = new Map<string, number>();

  entries.forEach((entry) => {
    entry.issue_areas.forEach((issueArea) => {
      counts.set(issueArea, (counts.get(issueArea) ?? 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([issueArea]) => ({
      issueArea,
      title: issueAreaLabels[issueArea] ?? issueArea.replaceAll("_", " "),
      entries: sortByFreshness(
        entries.filter((entry) => entry.issue_areas.includes(issueArea)),
      ).slice(0, 4),
    }));
}

export function ProfilesOverviewPage({ scope = "all", initialCatalog }: ProfilesOverviewPageProps) {
  const taxonomyQuery = useTaxonomy();
  const issueAreaLabels = useMemo(
    () => buildIssueAreaLabels(taxonomyQuery.data),
    [taxonomyQuery.data],
  );

  const catalogQuery = useEntries(
    {
      entry_types: lockedEntryTypesForScope(scope),
      limit: 18,
    },
    { initialData: initialCatalog },
  );
  const peopleQuery = useEntries({
    entry_types: ["person"],
    limit: 10,
  });
  const organizationsQuery = useEntries({
    entry_types: ["organization"],
    limit: 10,
  });

  const liveCatalogEntries = useMemo(
    () => catalogQuery.data?.data ?? [],
    [catalogQuery.data?.data],
  );
  const livePeopleEntries = useMemo(() => peopleQuery.data?.data ?? [], [peopleQuery.data?.data]);
  const liveOrganizationEntries = useMemo(
    () => organizationsQuery.data?.data ?? [],
    [organizationsQuery.data?.data],
  );

  const isLoading =
    catalogQuery.isLoading ||
    (scope === "all" && (peopleQuery.isLoading || organizationsQuery.isLoading));
  const catalogEntries = liveCatalogEntries;

  const heroEntries = catalogEntries.slice(0, 3);
  const scopedShelfEntries = catalogEntries.slice(3, 9);
  const peopleShelfEntries = useMemo(() => {
    if (scope === "all") {
      return livePeopleEntries;
    }

    if (scope === "people") {
      return scopedShelfEntries;
    }

    return [];
  }, [livePeopleEntries, scope, scopedShelfEntries]);
  const organizationShelfEntries = useMemo(() => {
    if (scope === "all") {
      return liveOrganizationEntries;
    }

    if (scope === "organizations") {
      return scopedShelfEntries;
    }

    return [];
  }, [liveOrganizationEntries, scope, scopedShelfEntries]);

  const issueLandscapeGroups = useMemo(
    () => buildIssueLandscapeGroups(catalogEntries, issueAreaLabels),
    [catalogEntries, issueAreaLabels],
  );

  const freshEntries = useMemo(() => {
    const heroIds = new Set(heroEntries.map((entry) => entry.id));

    return sortByFreshness(
      dedupeEntries([...catalogEntries, ...peopleShelfEntries, ...organizationShelfEntries]).filter(
        (entry) => !heroIds.has(entry.id),
      ),
    ).slice(0, 6);
  }, [catalogEntries, heroEntries, organizationShelfEntries, peopleShelfEntries]);

  const shouldShowEmptyState =
    !isLoading &&
    !catalogQuery.error &&
    heroEntries.length === 0 &&
    peopleShelfEntries.length === 0 &&
    organizationShelfEntries.length === 0 &&
    issueLandscapeGroups.length === 0 &&
    freshEntries.length === 0;

  return (
    <PageLayout className="pt-8 pb-8 lg:pt-12 lg:pb-10">
      <div className="mx-auto max-w-[78rem] space-y-10 lg:space-y-12">
        <ProfilesShowcaseHeader scope={scope} />

        {shouldShowEmptyState ? (
          <ProfilesEmptyState scope={scope} />
        ) : (
          <>
            <ProfilesMarquee
              entries={heroEntries}
              error={catalogQuery.error}
              isLoading={catalogQuery.isLoading}
              issueAreaLabels={issueAreaLabels}
            />

            {scope === "all" ? (
              <>
                <ProfilesShelf
                  entries={peopleShelfEntries}
                  error={peopleQuery.error}
                  icon={PROFILE_SHOWCASE_ICONS.people}
                  isLoading={peopleQuery.isLoading}
                  issueAreaLabels={issueAreaLabels}
                  subtitle="People"
                  title="People worth knowing"
                />
                <ProfilesShelf
                  entries={organizationShelfEntries}
                  error={organizationsQuery.error}
                  icon={PROFILE_SHOWCASE_ICONS.organizations}
                  isLoading={organizationsQuery.isLoading}
                  issueAreaLabels={issueAreaLabels}
                  subtitle="Organizations"
                  title="Organizations doing the work"
                />
              </>
            ) : null}

            {scope === "people" ? (
              <ProfilesShelf
                entries={peopleShelfEntries}
                icon={PROFILE_SHOWCASE_ICONS.people}
                isLoading={catalogQuery.isLoading && heroEntries.length === 0}
                issueAreaLabels={issueAreaLabels}
                subtitle="People"
                title="People worth knowing"
              />
            ) : null}

            {scope === "organizations" ? (
              <ProfilesShelf
                entries={organizationShelfEntries}
                icon={PROFILE_SHOWCASE_ICONS.organizations}
                isLoading={catalogQuery.isLoading && heroEntries.length === 0}
                issueAreaLabels={issueAreaLabels}
                subtitle="Organizations"
                title="Organizations doing the work"
              />
            ) : null}

            <ProfilesIssueLandscape
              groups={issueLandscapeGroups}
              isLoading={catalogQuery.isLoading}
            />
            <ProfilesFreshList entries={freshEntries} isLoading={catalogQuery.isLoading} />
          </>
        )}
      </div>
    </PageLayout>
  );
}
