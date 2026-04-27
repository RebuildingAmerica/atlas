import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Newspaper } from "lucide-react";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import {
  DetailSection,
  FactRail,
  FactTile,
  SurfaceBlock,
  formatProfileLocation,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { NetworkRails } from "@/domains/catalog/components/profiles/network-rails";
import { ProfileHero } from "@/domains/catalog/components/profiles/profile-hero";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import { ReachSection } from "@/domains/catalog/components/profiles/reach-section";
import { WorkSection } from "@/domains/catalog/components/profiles/work-section";
import { useConnections } from "@/domains/catalog/hooks/use-connections";
import { useEntry } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { humanize } from "@/domains/catalog/catalog";
import { PageLayout } from "@/platform/layout/page-layout";
import type { Entry } from "@/types";

interface PersonProfilePageProps {
  entry: Entry;
}

function formatCountSummary(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function NavigationBlock({ affiliatedOrg }: { affiliatedOrg?: Entry }) {
  return (
    <div className="space-y-3">
      <p className="type-label-medium text-ink-muted">Keep browsing</p>
      <div className="space-y-2">
        <Link
          to="/profiles"
          className="type-body-medium text-ink-soft hover:text-ink-strong block transition-colors"
        >
          All profiles
        </Link>
        <Link
          to="/profiles/people"
          className="type-body-medium text-ink-soft hover:text-ink-strong block transition-colors"
        >
          More people
        </Link>
        {affiliatedOrg ? (
          <Link
            to="/profiles/organizations/$slug"
            params={{ slug: affiliatedOrg.slug }}
            className="type-body-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-1 transition-colors"
          >
            {affiliatedOrg.name}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function AffiliatedOrgCard({ org }: { org: Entry }) {
  return (
    <SurfaceBlock>
      <div className="space-y-3">
        <p className="type-label-small text-ink-muted tracking-[0.18em] uppercase">
          Affiliated with
        </p>
        <Link
          to="/profiles/organizations/$slug"
          params={{ slug: org.slug }}
          className="bg-surface-container-low hover:bg-surface-container-high flex items-center gap-4 rounded-[1rem] px-4 py-4 transition-colors"
        >
          <ActorAvatar name={org.name} type="organization" size="md" />
          <div className="min-w-0 flex-1">
            <p className="type-title-medium text-ink-strong">{org.name}</p>
            <p className="type-body-medium text-ink-muted">{formatProfileLocation(org)}</p>
          </div>
          <ArrowUpRight className="text-ink-muted h-4 w-4 shrink-0" />
        </Link>
      </div>
    </SurfaceBlock>
  );
}

export function PersonProfilePage({ entry }: PersonProfilePageProps) {
  const taxonomyQuery = useTaxonomy();
  const connectionsQuery = useConnections(entry.id);
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

  const factRail = (
    <FactRail>
      <FactTile label="Based in" value={formatProfileLocation(entry)} />
      <FactTile
        label="Affiliation"
        value={
          affiliatedOrgQuery.data ? (
            <Link
              to="/profiles/organizations/$slug"
              params={{ slug: affiliatedOrgQuery.data.slug }}
              className="hover:text-accent inline-flex items-center gap-1 transition-colors"
            >
              {affiliatedOrgQuery.data.name}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <span className="text-ink-soft">No organization linked yet</span>
          )
        }
      />
      <FactTile
        label="Issue areas"
        value={
          focusLabels.length > 0 ? (
            formatCountSummary(focusLabels.length, "area")
          ) : (
            <span className="text-ink-soft">Still being surfaced</span>
          )
        }
      />
      <FactTile label="Coverage" value={formatCountSummary(entry.source_count, "source")} />
    </FactRail>
  );

  return (
    <PageLayout className="pt-0 pb-12">
      <ProfileJsonLd entry={entry} affiliatedOrg={affiliatedOrgQuery.data} />

      <div className="space-y-10">
        <ProfileHero
          entry={entry}
          eyebrow="Person profile"
          backLink={{ to: "/profiles/people", label: "Back to people" }}
          factRail={factRail}
        />

        <div className="mx-auto grid max-w-[76rem] gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <main className="space-y-10">
            <WorkSection entry={entry} issueAreaLabels={issueAreaLabels} />

            {affiliatedOrgQuery.data ? <AffiliatedOrgCard org={affiliatedOrgQuery.data} /> : null}

            <DetailSection eyebrow="Evidence" title="Reporting trail">
              <SurfaceBlock>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Newspaper className="text-ink-muted h-4 w-4" />
                    <p className="type-body-medium text-ink-soft">
                      Public sources that mention, quote, or place this person in the record.
                    </p>
                  </div>
                  <AppearancesList sources={entry.sources ?? []} mode="person" />
                </div>
              </SurfaceBlock>
            </DetailSection>

            <DetailSection eyebrow="Network · the portal" title="Who else is doing this work">
              <NetworkRails
                entry={entry}
                connections={connectionsQuery.data ?? []}
                isLoading={connectionsQuery.isLoading}
              />
            </DetailSection>
          </main>

          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            {hasReach ? (
              <SurfaceBlock>
                <ReachSection email={entry.email} website={entry.website} phone={entry.phone} />
              </SurfaceBlock>
            ) : null}

            <SurfaceBlock>
              <DataQualityBlock entry={entry} />
            </SurfaceBlock>

            <SurfaceBlock>
              <NavigationBlock affiliatedOrg={affiliatedOrgQuery.data} />
            </SurfaceBlock>
          </aside>
        </div>
      </div>
    </PageLayout>
  );
}
