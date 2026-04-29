import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Newspaper } from "lucide-react";
import { useAtlasSession } from "@/domains/access";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { ActionCluster } from "@/domains/catalog/components/profiles/action-cluster";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import { formatProfileLocation } from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { NetworkRails } from "@/domains/catalog/components/profiles/network-rails";
import { ProfileHero } from "@/domains/catalog/components/profiles/profile-hero";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import { ProfileStats } from "@/domains/catalog/components/profiles/profile-stats";
import { ReachSection } from "@/domains/catalog/components/profiles/reach-section";
import { SignatureQuote } from "@/domains/catalog/components/profiles/signature-quote";
import { WorkSection } from "@/domains/catalog/components/profiles/work-section";
import { useConnections } from "@/domains/catalog/hooks/use-connections";
import { useEntry } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { humanize } from "@/domains/catalog/catalog";
import type { Entry } from "@/types";

interface PersonProfilePageProps {
  entry: Entry;
}

const PANEL = "border border-border-taupe border-t-0 bg-surface-container-lowest px-6 py-6 sm:px-8";

const PANEL_HEADER = "font-mono text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft";

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
  if (typeof window !== "undefined") return window.location.href;
  return `https://rebuildingus.org/profiles/people/${slug}`;
}

export function PersonProfilePage({ entry }: PersonProfilePageProps) {
  const taxonomyQuery = useTaxonomy();
  const connectionsQuery = useConnections(entry.id);
  const sessionQuery = useAtlasSession();
  const isSignedIn = Boolean(sessionQuery.data);
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
  const lastConfirmed = shortRelative(entry.latest_source_date ?? entry.last_seen);

  const stats = [
    {
      label: "Coverage",
      value: entry.source_count,
      unit: entry.source_count === 1 ? "src" : "srcs",
    },
    { label: "Issue areas", value: focusLabels.length },
    { label: "Tracked since", value: trackedValue, unit: trackedUnit },
    { label: "Last confirmed", value: lastConfirmed },
  ];

  const profilePath = `/profiles/people/${entry.slug}`;

  return (
    <div className="bg-page-bg pb-12">
      <ProfileJsonLd entry={entry} affiliatedOrg={affiliatedOrgQuery.data} />

      <div className="mx-auto max-w-[60rem] px-4 py-6 sm:px-6">
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

        <SignatureQuote sources={entry.sources ?? []} />

        <ProfileStats items={stats} />

        <WorkSection entry={entry} issueAreaLabels={issueAreaLabels} />

        {affiliatedOrgQuery.data ? (
          <section aria-label="Affiliated organization" className={PANEL}>
            <span className={PANEL_HEADER}>Affiliated with</span>
            <Link
              to="/profiles/organizations/$slug"
              params={{ slug: affiliatedOrgQuery.data.slug }}
              className="border-border-taupe hover:border-civic bg-paper mt-3 flex items-center gap-4 border p-4 transition-colors"
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
          </section>
        ) : null}

        {hasReach ? (
          <section aria-label="Contact details" className={PANEL}>
            <span className={PANEL_HEADER}>Reach</span>
            <div className="mt-3">
              <ReachSection email={entry.email} website={entry.website} phone={entry.phone} />
            </div>
          </section>
        ) : null}

        <section aria-label="Reporting trail" className={PANEL}>
          <div className="mb-4 flex items-center gap-2">
            <Newspaper className="text-ink-soft h-4 w-4" aria-hidden />
            <span className={PANEL_HEADER}>Reporting trail</span>
          </div>
          <AppearancesList sources={entry.sources ?? []} mode="person" />
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
