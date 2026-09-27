import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Building2,
  History,
  Mail,
  Network,
  Newspaper,
  ShieldCheck,
  Tags,
} from "lucide-react";
import { useAtlasSession } from "@/domains/access";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { ActionCluster } from "@/domains/catalog/components/profiles/action-cluster";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import { IssueFootprint } from "@/domains/catalog/components/profiles/issue-footprint";
import {
  formatProfileLocation,
  ProfileSection,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { ConnectionList } from "@/domains/catalog/components/profiles/connection-list";
import { ProfileHero } from "@/domains/catalog/components/profiles/profile-hero";
import { ProfileHistory } from "@/domains/catalog/components/profiles/profile-history";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import { ProfileStats } from "@/domains/catalog/components/profiles/profile-stats";
import { ReachSection } from "@/domains/catalog/components/profiles/reach-section";
import { useProfileConnections } from "@/domains/catalog/hooks/use-profile-entry";
import { useEntry } from "@rebuildingamerica/atlas-catalog/hooks/use-entries";
import { useTaxonomy } from "@rebuildingamerica/atlas-catalog/hooks/use-taxonomy";
import { humanize } from "@rebuildingamerica/atlas-catalog/catalog";
import { buildCanonicalUrl } from "@/platform/seo";
import type { ConnectionNetwork, Entry } from "@rebuildingamerica/atlas-api-client";

interface PersonProfilePageProps {
  entry: Entry;
  initialConnections?: ConnectionNetwork;
  resumeSave?: boolean;
}

function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(0, months);
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
  return buildCanonicalUrl(`/profiles/people/${slug}`);
}

export function PersonProfilePage({
  entry,
  initialConnections,
  resumeSave,
}: PersonProfilePageProps) {
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
  const affiliatedOrgQuery = useEntry(entry.affiliated_org_id ?? "", {
    enabled: Boolean(entry.affiliated_org_id),
  });

  const issueAreaLabels = Object.fromEntries(
    Object.values(taxonomyQuery.data ?? {})
      .flat()
      .map((issue) => [issue.slug, issue.name]),
  );

  const focusLabels = entry.issue_areas.map((area) => issueAreaLabels[area] ?? humanize(area));
  const hasReach = Boolean(entry.email || entry.website || entry.phone);
  const monthsTracked = monthsBetween(entry.first_seen, entry.last_seen);
  const trackedValue = monthsTracked >= 12 ? `${Math.round(monthsTracked / 12)}` : monthsTracked;
  const trackedUnit = monthsTracked >= 12 ? "yr" : "mo";
  const latestSource = entry.latest_source_date ? shortRelative(entry.latest_source_date) : "—";

  const stats = [
    {
      label: "Coverage",
      value: entry.source_count,
      unit: entry.source_count === 1 ? "src" : "srcs",
    },
    { label: "Issue areas", value: focusLabels.length },
    { label: "Tracked since", value: trackedValue, unit: trackedUnit },
    { label: "Latest source", value: latestSource },
  ];

  const profilePath = `/profiles/people/${entry.slug}`;

  return (
    <div className="bg-page-bg pb-12">
      <ProfileJsonLd entry={entry} affiliatedOrg={affiliatedOrgQuery.data} />

      <div className="mx-auto max-w-[60rem] space-y-3 px-4 py-6 sm:px-6">
        <ProfileHero
          entry={entry}
          affiliation={
            affiliatedOrgQuery.data
              ? {
                  name: affiliatedOrgQuery.data.name,
                  href: `/profiles/organizations/${affiliatedOrgQuery.data.slug}`,
                }
              : undefined
          }
        />

        <ActionCluster
          entryId={entry.id}
          entrySlug={entry.slug}
          shareUrl={buildShareUrl(entry.slug)}
          shareTitle={entry.name}
          email={entry.email}
          emailGrounded={entry.trust.email_grounded}
          website={entry.website}
          websiteGrounded={entry.trust.website_grounded}
          isSignedIn={isSignedIn}
          readyForActions={readyForActions}
          profilePath={profilePath}
          resumeSave={resumeSave}
          sourcesHref={entry.sources?.length ? "#reporting-trail" : undefined}
          workspaceId={activeWorkspaceId}
          workspaceWatchingEnabled={workspaceWatchingEnabled}
        />

        {hasReach ? (
          <ProfileSection
            label="Contact details"
            sectionId="contact-details"
            title="Reach"
            Icon={Mail}
          >
            <ReachSection
              email={entry.email}
              website={entry.website}
              phone={entry.phone}
              emailGrounded={entry.trust.email_grounded}
              websiteGrounded={entry.trust.website_grounded}
            />
          </ProfileSection>
        ) : null}

        {entry.issue_areas.length > 0 ? (
          <ProfileSection label="Issue focus" sectionId="issue-focus" Icon={Tags}>
            <IssueFootprint
              issueAreas={entry.issue_areas}
              issueAreaLabels={issueAreaLabels}
              showLabel={false}
            />
          </ProfileSection>
        ) : null}

        {affiliatedOrgQuery.data ? (
          <ProfileSection
            label="Affiliated organization"
            sectionId="affiliated-organization"
            title="Affiliated with"
            Icon={Building2}
          >
            <Link
              to="/profiles/organizations/$slug"
              params={{ slug: affiliatedOrgQuery.data.slug }}
              className="border-border-taupe hover:border-civic bg-paper flex items-center gap-4 border p-4 transition-colors"
            >
              <ActorAvatar
                name={affiliatedOrgQuery.data.name}
                type="organization"
                size="md"
                photoUrl={affiliatedOrgQuery.data.photo_url}
              />
              <div className="min-w-0 flex-1">
                <p className="text-ink-strong text-base font-semibold">
                  {affiliatedOrgQuery.data.name}
                </p>
                <p className="text-ink-soft text-sm">
                  {formatProfileLocation(affiliatedOrgQuery.data)}
                </p>
              </div>
              <ArrowUpRight className="text-ink-soft h-4 w-4 shrink-0" />
            </Link>
          </ProfileSection>
        ) : null}

        <ProfileSection
          label="Sources for this profile"
          sectionId="reporting-trail"
          Icon={Newspaper}
          htmlId="reporting-trail"
        >
          <AppearancesList sources={entry.sources ?? []} mode="person" />
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
            isLoading={connectionsQuery.isPending}
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
