import { Newspaper } from "lucide-react";
import { useAtlasSession } from "@/domains/access";
import { ActionCluster } from "@/domains/catalog/components/profiles/action-cluster";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { AvatarRow } from "@/domains/catalog/components/profiles/avatar-row";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import { IssueFootprint } from "@/domains/catalog/components/profiles/issue-footprint";
import { NetworkRails } from "@/domains/catalog/components/profiles/network-rails";
import { PresenceSection } from "@/domains/catalog/components/profiles/presence-section";
import { ProfileHero } from "@/domains/catalog/components/profiles/profile-hero";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import { ProfileStats } from "@/domains/catalog/components/profiles/profile-stats";
import { SignatureQuote } from "@/domains/catalog/components/profiles/signature-quote";
import { WorkSection } from "@/domains/catalog/components/profiles/work-section";
import { useConnections } from "@/domains/catalog/hooks/use-connections";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import type { Entry } from "@/types";

interface OrgProfilePageProps {
  entry: Entry;
}

const PANEL = "border border-border-taupe border-t-0 bg-surface-container-lowest px-6 py-6 sm:px-8";

const PANEL_HEADER = "font-mono text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft";

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

export function OrgProfilePage({ entry }: OrgProfilePageProps) {
  const taxonomyQuery = useTaxonomy();
  const connectionsQuery = useConnections(entry.id);
  const sessionQuery = useAtlasSession();
  const isSignedIn = Boolean(sessionQuery.data);
  const affiliatedPeopleQuery = useEntries({ entry_types: ["person"], limit: 50 });
  const affiliatedPeople = (affiliatedPeopleQuery.data?.data ?? []).filter(
    (person) => person.affiliated_org_id === entry.id,
  );

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

      <div className="mx-auto max-w-[60rem] px-4 py-6 sm:px-6">
        <ProfileHero entry={entry} />

        <SignatureQuote sources={entry.sources ?? []} />

        <ProfileStats items={stats} />

        <WorkSection entry={entry} issueAreaLabels={issueAreaLabels} showIssueChips={false} />

        {entry.issue_areas.length > 0 ? (
          <section aria-label="Issue footprint" className={PANEL}>
            <span className={PANEL_HEADER}>Issue footprint</span>
            <div className="mt-3">
              <IssueFootprint
                issueAreas={entry.issue_areas}
                issueAreaLabels={issueAreaLabels}
                showLabel={false}
              />
            </div>
          </section>
        ) : null}

        {affiliatedPeople.length > 0 ? (
          <section aria-label="People tied to this organization" className={PANEL}>
            <div className="mb-3 flex items-baseline gap-3">
              <span className={PANEL_HEADER}>People</span>
              <h2 className="text-ink-strong text-base font-semibold">
                People tied to this organization
              </h2>
            </div>
            <AvatarRow people={affiliatedPeople} showHeader={false} />
          </section>
        ) : null}

        {hasPresence ? (
          <section aria-label="Presence and contact" className={PANEL}>
            <span className={PANEL_HEADER}>Presence</span>
            <div className="mt-3">
              <PresenceSection
                website={entry.website}
                email={entry.email}
                phone={entry.phone}
                firstSeen={entry.first_seen}
              />
            </div>
          </section>
        ) : null}

        <section aria-label="Appearances and coverage" className={PANEL}>
          <div className="mb-4 flex items-center gap-2">
            <Newspaper className="text-ink-soft h-4 w-4" aria-hidden />
            <span className={PANEL_HEADER}>Appearances and coverage</span>
          </div>
          <AppearancesList sources={entry.sources ?? []} mode="organization" />
        </section>

        <section aria-label="Network — actors related to this profile" className={PANEL}>
          <div className="mb-4 flex flex-wrap items-baseline gap-x-3">
            <span className={PANEL_HEADER}>Network</span>
            <h2 className="text-ink-strong text-base font-semibold">Who else is doing this work</h2>
          </div>
          <NetworkRails
            entry={entry}
            connections={connectionsQuery.data ?? []}
            isLoading={connectionsQuery.isLoading}
          />
        </section>

        <section aria-label="Data quality" className={PANEL}>
          <DataQualityBlock entry={entry} />
        </section>

        <ActionCluster
          entryId={entry.id}
          entrySlug={entry.slug}
          shareUrl={buildShareUrl(entry.slug)}
          shareTitle={entry.name}
          email={entry.email}
          isSignedIn={isSignedIn}
          profilePath={profilePath}
        />
      </div>
    </div>
  );
}
