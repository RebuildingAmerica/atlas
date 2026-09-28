import { Contact, History, Network, Newspaper, ShieldCheck, Tags, Users } from "lucide-react";
import { useAtlasSession } from "@/domains/access";
import { ActionCluster } from "@/domains/catalog/components/profiles/action-cluster";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { AvatarRow } from "@/domains/catalog/components/profiles/avatar-row";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import { IssueFootprint } from "@/domains/catalog/components/profiles/issue-footprint";
import { ConnectionList } from "@/domains/catalog/components/profiles/connection-list";
import { PresenceSection } from "@/domains/catalog/components/profiles/presence-section";
import { ProfileHero } from "@/domains/catalog/components/profiles/profile-hero";
import { ProfileHistory } from "@/domains/catalog/components/profiles/profile-history";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import { ProfileStats } from "@/domains/catalog/components/profiles/profile-stats";
import { ProfileSection } from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { useProfileConnections } from "@/domains/catalog/hooks/use-profile-entry";
import { useEntries } from "@rebuildingamerica/atlas-catalog/hooks/use-entries";
import { useTaxonomy } from "@rebuildingamerica/atlas-catalog/hooks/use-taxonomy";
import { PUBLIC_QUERY_RETRY_OPTIONS } from "@/platform/query/public-query-retry";
import { buildCanonicalUrl } from "@/platform/seo";
import type { ConnectionNetwork, Entry } from "@rebuildingamerica/atlas-api-client";

interface OrgProfilePageProps {
  entry: Entry;
  initialConnections?: ConnectionNetwork;
  resumeSave?: boolean;
}

function shortRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";
  const days = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
  if (days === 0) return "today";
  if (days < 7) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 730) return `${Math.round(days / 30)}mo`;
  return `${Math.floor(days / 365)}y+`;
}

function buildShareUrl(slug: string): string {
  return buildCanonicalUrl(`/profiles/organizations/${slug}`);
}

export function OrgProfilePage({ entry, initialConnections, resumeSave }: OrgProfilePageProps) {
  const taxonomyQuery = useTaxonomy();
  const connectionsQuery = useProfileConnections(entry.id, initialConnections);
  const sessionQuery = useAtlasSession();
  const session = sessionQuery.data ?? null;
  const isSignedIn = session !== null;
  const readyForActions = Boolean(session?.accountReady && session.hasPasskey);
  const activeWorkspaceId = session?.workspace.activeOrganization?.id ?? null;
  const workspaceWatchingEnabled =
    session !== null &&
    readyForActions &&
    activeWorkspaceId !== null &&
    session.workspace.resolvedCapabilities.capabilities.includes("monitoring.watchlists");
  const affiliatedPeopleQuery = useEntries(
    {
      affiliated_org_id: entry.id,
      entry_types: ["person"],
      limit: 50,
    },
    PUBLIC_QUERY_RETRY_OPTIONS,
  );
  const affiliatedPeople = affiliatedPeopleQuery.data?.data ?? [];

  const issueAreaLabels = Object.fromEntries(
    Object.values(taxonomyQuery.data ?? {})
      .flat()
      .map((issue) => [issue.slug, issue.name]),
  );

  const hasPresence = Boolean(entry.website || entry.email || entry.phone);
  const latestSource = entry.latest_source_date ? shortRelative(entry.latest_source_date) : "—";

  const stats = [
    {
      label: "Coverage",
      value: entry.source_count,
      unit: entry.source_count === 1 ? "src" : "srcs",
    },
    // A count of zero before the lookup answers would tell the visitor nobody
    // works here, so the tile holds a dash until it does.
    {
      label: "People tied",
      value: affiliatedPeopleQuery.data ? affiliatedPeople.length : "—",
    },
    { label: "Issue areas", value: entry.issue_areas.length },
    { label: "Latest source", value: latestSource },
  ];

  const profilePath = `/profiles/organizations/${entry.slug}`;

  return (
    <div className="bg-page-bg pb-12">
      <ProfileJsonLd entry={entry} affiliatedPeople={affiliatedPeople} />

      <div className="mx-auto max-w-[60rem] space-y-3 px-4 py-6 sm:px-6">
        <ProfileHero entry={entry} />

        <ActionCluster
          entryId={entry.id}
          entrySlug={entry.slug}
          shareUrl={buildShareUrl(entry.slug)}
          shareTitle={entry.name}
          email={entry.email}
          emailGrounded={entry.trust.email_grounded}
          actionUrl={entry.action_url}
          actionGrounded={entry.sources?.some(
            (source) => source.url === entry.action_url && source.type === "org_website",
          )}
          website={entry.website}
          websiteGrounded={entry.trust.website_grounded}
          isSignedIn={isSignedIn}
          readyForActions={readyForActions}
          profilePath={profilePath}
          resumeSave={resumeSave}
          sourcesHref={entry.sources?.length ? "#appearances" : undefined}
          workspaceId={activeWorkspaceId}
          workspaceWatchingEnabled={workspaceWatchingEnabled}
        />

        {hasPresence ? (
          <ProfileSection
            label="Presence and contact"
            sectionId="presence-contact"
            title="Presence"
            Icon={Contact}
          >
            <PresenceSection
              website={entry.website}
              email={entry.email}
              phone={entry.phone}
              websiteGrounded={entry.trust.website_grounded}
              emailGrounded={entry.trust.email_grounded}
            />
          </ProfileSection>
        ) : null}

        {entry.issue_areas.length > 0 ? (
          <ProfileSection label="Issue footprint" sectionId="issue-footprint" Icon={Tags}>
            <IssueFootprint
              issueAreas={entry.issue_areas}
              issueAreaLabels={issueAreaLabels}
              showLabel={false}
            />
          </ProfileSection>
        ) : null}

        <ProfileSection
          label="Sources for this profile"
          sectionId="appearances"
          Icon={Newspaper}
          htmlId="appearances"
        >
          <AppearancesList sources={entry.sources ?? []} mode="organization" />
        </ProfileSection>

        {affiliatedPeople.length > 0 ? (
          <ProfileSection
            label="People tied to this organization"
            sectionId="people"
            title="People tied to this organization"
            Icon={Users}
          >
            <AvatarRow people={affiliatedPeople} showHeader={false} />
          </ProfileSection>
        ) : null}
        {affiliatedPeopleQuery.isError && !affiliatedPeopleQuery.data ? (
          <ProfileSection label="People tied to this organization" sectionId="people" Icon={Users}>
            <div role="alert" className="space-y-2">
              <p className="type-body-medium text-ink-soft">
                People tied to this group could not load.
              </p>
              <button
                type="button"
                onClick={() => void affiliatedPeopleQuery.refetch()}
                className="type-label-medium text-ink-strong underline"
              >
                Try again
              </button>
            </div>
          </ProfileSection>
        ) : null}

        <ProfileSection
          label="Network — actors related to this profile"
          sectionId="network"
          title="Who else is doing this work"
          Icon={Network}
          htmlId="connections"
          className="scroll-mt-20"
        >
          <ConnectionList
            entry={entry}
            network={connectionsQuery.data}
            isLoading={connectionsQuery.isPending}
            isError={connectionsQuery.isError}
            onRetry={connectionsQuery.refetch}
          />
        </ProfileSection>

        <ProfileStats items={stats} />

        <ProfileSection label="Sources and trust" sectionId="sources-and-trust" Icon={ShieldCheck}>
          <DataQualityBlock entry={entry} />
        </ProfileSection>

        <ProfileSection label="Record history" sectionId="record-history" Icon={History}>
          <ProfileHistory entry={entry} />
        </ProfileSection>
      </div>
    </div>
  );
}
