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
import { useEntries } from "@rebuildingamerica/atlas-catalog/hooks/use-entries";
import { useTaxonomy } from "@rebuildingamerica/atlas-catalog/hooks/use-taxonomy";
import {
  lockedEntryTypesForScope,
  type ProfileBrowseScope,
} from "@/domains/catalog/profile-browse";
import { PageLayout } from "@rebuildingamerica/atlas-ui/layout/page-layout";
import {
  PUBLIC_QUERY_RETRY_OPTIONS,
  shouldRetryPublicQuery,
} from "@/platform/query/public-query-retry";
import type { Entry, EntryListResponse } from "@rebuildingamerica/atlas-api-client";

interface ProfilesOverviewPageProps {
  scope?: ProfileBrowseScope;
  /**
   * Server-rendered catalog slice — present when the route loader supplied
   * one. Threaded into `useEntries` as `initialData` so the marquee renders
   * immediately on first paint.
   */
  initialCatalog?: EntryListResponse;
}

// A temporary failure gets one automatic retry, then a visible recovery path.
const PROFILE_QUERY_OPTIONS = {
  ...PUBLIC_QUERY_RETRY_OPTIONS,
  retry: (failureCount: number, error: unknown) =>
    failureCount < 1 && shouldRetryPublicQuery(failureCount, error),
};

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
    // `updated_at` is required on every Entry, so there is nothing further to
    // fall back to: an entry with no source date is ordered by its own last
    // edit rather than silently pretending to be as old as its creation.
    const leftValue = new Date(left.latest_source_date ?? left.updated_at).getTime();
    const rightValue = new Date(right.latest_source_date ?? right.updated_at).getTime();

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

  // Keep available slices visible if another request fails.
  const catalogQuery = useEntries(
    {
      entry_types: lockedEntryTypesForScope(scope),
      limit: 18,
    },
    { ...PROFILE_QUERY_OPTIONS, initialData: initialCatalog },
  );
  const peopleQuery = useEntries(
    {
      entry_types: ["person"],
      limit: 10,
    },
    { ...PROFILE_QUERY_OPTIONS, enabled: scope === "all" },
  );
  const organizationsQuery = useEntries(
    {
      entry_types: ["organization"],
      limit: 10,
    },
    { ...PROFILE_QUERY_OPTIONS, enabled: scope === "all" },
  );

  const liveCatalogEntries = useMemo(
    () => catalogQuery.data?.data ?? [],
    [catalogQuery.data?.data],
  );
  const livePeopleEntries = useMemo(() => peopleQuery.data?.data ?? [], [peopleQuery.data?.data]);
  const liveOrganizationEntries = useMemo(
    () => organizationsQuery.data?.data ?? [],
    [organizationsQuery.data?.data],
  );

  // `isPending` rather than `isLoading`: React Query pauses a retry while the
  // visitor is offline, and a paused slice has no data yet either.
  const isLoading =
    catalogQuery.isPending ||
    (scope === "all" && (peopleQuery.isPending || organizationsQuery.isPending));
  const catalogFailure = catalogQuery.isError;
  const peopleFailure = scope === "all" && peopleQuery.isError;
  const organizationsFailure = scope === "all" && organizationsQuery.isError;
  const hasLoadError = catalogFailure || peopleFailure || organizationsFailure;
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
    !hasLoadError &&
    heroEntries.length === 0 &&
    peopleShelfEntries.length === 0 &&
    organizationShelfEntries.length === 0 &&
    issueLandscapeGroups.length === 0 &&
    freshEntries.length === 0;

  return (
    <PageLayout className="pt-8 pb-8 lg:pt-12 lg:pb-10">
      <div className="mx-auto max-w-[78rem] space-y-10 lg:space-y-12">
        <ProfilesShowcaseHeader scope={scope} />

        {hasLoadError ? (
          <div
            role="alert"
            className="bg-error-container text-on-error-container rounded-xl px-5 py-4"
          >
            <p className="type-body-medium font-semibold">Profiles couldn't load.</p>
            <p className="type-body-small mt-1">You can still use any results shown below.</p>
            <button
              type="button"
              className="type-label-medium mt-3 underline underline-offset-4 disabled:opacity-60"
              disabled={
                catalogQuery.isFetching || peopleQuery.isFetching || organizationsQuery.isFetching
              }
              onClick={() => {
                if (catalogFailure) void catalogQuery.refetch();
                if (peopleFailure) void peopleQuery.refetch();
                if (organizationsFailure) void organizationsQuery.refetch();
              }}
            >
              Try again
            </button>
          </div>
        ) : null}

        {shouldShowEmptyState ? (
          <ProfilesEmptyState scope={scope} />
        ) : (
          <>
            <ProfilesMarquee
              entries={heroEntries}
              isLoading={catalogQuery.isPending}
              issueAreaLabels={issueAreaLabels}
            />

            {scope === "all" ? (
              <>
                <ProfilesShelf
                  entries={peopleShelfEntries}
                  icon={PROFILE_SHOWCASE_ICONS.people}
                  isLoading={peopleQuery.isPending}
                  issueAreaLabels={issueAreaLabels}
                  subtitle="People"
                  title="People worth knowing"
                />
                <ProfilesShelf
                  entries={organizationShelfEntries}
                  icon={PROFILE_SHOWCASE_ICONS.organizations}
                  isLoading={organizationsQuery.isPending}
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
                isLoading={catalogQuery.isPending && heroEntries.length === 0}
                issueAreaLabels={issueAreaLabels}
                subtitle="People"
                title="People worth knowing"
              />
            ) : null}

            {scope === "organizations" ? (
              <ProfilesShelf
                entries={organizationShelfEntries}
                icon={PROFILE_SHOWCASE_ICONS.organizations}
                isLoading={catalogQuery.isPending && heroEntries.length === 0}
                issueAreaLabels={issueAreaLabels}
                subtitle="Organizations"
                title="Organizations doing the work"
              />
            ) : null}

            <ProfilesIssueLandscape
              groups={issueLandscapeGroups}
              isLoading={catalogQuery.isPending}
            />
            <ProfilesFreshList entries={freshEntries} isLoading={catalogQuery.isPending} />
          </>
        )}
      </div>
    </PageLayout>
  );
}
