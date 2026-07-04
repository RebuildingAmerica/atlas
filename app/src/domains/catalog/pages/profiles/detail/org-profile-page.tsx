import { Contact, History, Network, Newspaper, ShieldCheck, Tags, Users } from "lucide-react";
import { useAtlasSession } from "@/domains/access";
import { ActionCluster } from "@/domains/catalog/components/profiles/action-cluster";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { AvatarRow } from "@/domains/catalog/components/profiles/avatar-row";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import { IssueFootprint } from "@/domains/catalog/components/profiles/issue-footprint";
import { ConnectionList } from "@/domains/catalog/components/profiles/connection-list";
import { PresenceSection } from "@/domains/catalog/components/profiles/presence-section";
import { ProfileAnswerCard } from "@/domains/catalog/components/profiles/profile-answer-card";
import { ProfileHero } from "@/domains/catalog/components/profiles/profile-hero";
import { ProfileHistory } from "@/domains/catalog/components/profiles/profile-history";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import { ProfileResearchContext } from "@/domains/catalog/components/profiles/profile-research-context";
import { ProfileStats } from "@/domains/catalog/components/profiles/profile-stats";
import { SignatureQuote } from "@/domains/catalog/components/profiles/signature-quote";
import { WorkSection } from "@/domains/catalog/components/profiles/work-section";
import { ProfileSection } from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { useConnections } from "@/domains/catalog/hooks/use-connections";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import type { ConnectionNetwork, Entry } from "@/types";

interface OrgProfilePageProps {
  entry: Entry;
  initialConnections?: ConnectionNetwork;
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
  if (typeof window !== "undefined") return window.location.href;
  return `https://rebuildingus.org/profiles/organizations/${slug}`;
}

export function OrgProfilePage({ entry, initialConnections }: OrgProfilePageProps) {
  const taxonomyQuery = useTaxonomy();
  const connectionsQuery = useConnections(entry.id, { initialData: initialConnections });
  const sessionQuery = useAtlasSession();
  const isSignedIn = Boolean(sessionQuery.data);
  const activeWorkspaceId = sessionQuery.data?.workspace.activeOrganization?.id ?? null;
  const workspaceWatchingEnabled =
    activeWorkspaceId !== null &&
    (sessionQuery.data?.workspace.resolvedCapabilities.capabilities.includes(
      "monitoring.watchlists",
    ) ??
      false);
  const affiliatedPeopleQuery = useEntries({
    affiliated_org_id: entry.id,
    entry_types: ["person"],
    limit: 50,
  });
  const affiliatedPeople = affiliatedPeopleQuery.data?.data ?? [];

  const issueAreaLabels = Object.fromEntries(
    Object.values(taxonomyQuery.data ?? {})
      .flat()
      .map((issue) => [issue.slug, issue.name]),
  );

  const hasPresence = Boolean(entry.website || entry.email || entry.phone || entry.first_seen);
  const lastConfirmed = shortRelative(entry.latest_source_date ?? entry.last_seen);

  const stats = [
    {
      label: "Coverage",
      value: entry.source_count,
      unit: entry.source_count === 1 ? "src" : "srcs",
    },
    { label: "People tied", value: affiliatedPeople.length },
    { label: "Issue areas", value: entry.issue_areas.length },
    { label: "Last confirmed", value: lastConfirmed },
  ];

  const profilePath = `/profiles/organizations/${entry.slug}`;

  return (
    <div className="bg-page-bg pb-12">
      <ProfileJsonLd entry={entry} affiliatedPeople={affiliatedPeople} />

      <div className="mx-auto max-w-[60rem] space-y-3 px-4 py-6 sm:px-6">
        <ProfileHero entry={entry} />

        <ProfileAnswerCard entry={entry} issueAreaLabels={issueAreaLabels} />

        <ProfileResearchContext entry={entry} issueAreaLabels={issueAreaLabels} />

        <SignatureQuote sources={entry.sources ?? []} />

        <ProfileStats items={stats} />

        <ProfileSection label="Record history" sectionId="record-history" Icon={History}>
          <ProfileHistory entry={entry} />
        </ProfileSection>

        <WorkSection entry={entry} issueAreaLabels={issueAreaLabels} showIssueChips={false} />

        {entry.issue_areas.length > 0 ? (
          <ProfileSection label="Issue footprint" sectionId="issue-footprint" Icon={Tags}>
            <IssueFootprint
              issueAreas={entry.issue_areas}
              issueAreaLabels={issueAreaLabels}
              showLabel={false}
            />
          </ProfileSection>
        ) : null}

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
              firstSeen={entry.first_seen}
              websiteGrounded={entry.trust.website_grounded}
              emailGrounded={entry.trust.email_grounded}
            />
          </ProfileSection>
        ) : null}

        <ProfileSection label="Appearances and coverage" sectionId="appearances" Icon={Newspaper}>
          <AppearancesList sources={entry.sources ?? []} mode="organization" />
        </ProfileSection>

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
            isLoading={connectionsQuery.isLoading}
          />
        </ProfileSection>

        <ProfileSection label="Data quality" sectionId="data-quality" Icon={ShieldCheck}>
          <DataQualityBlock entry={entry} />
        </ProfileSection>

        <ActionCluster
          entryId={entry.id}
          entrySlug={entry.slug}
          shareUrl={buildShareUrl(entry.slug)}
          shareTitle={entry.name}
          email={entry.email}
          isSignedIn={isSignedIn}
          profilePath={profilePath}
          workspaceId={activeWorkspaceId}
          workspaceWatchingEnabled={workspaceWatchingEnabled}
        />
      </div>
    </div>
  );
}
