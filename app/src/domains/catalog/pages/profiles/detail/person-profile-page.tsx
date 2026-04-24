import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, Newspaper } from "lucide-react";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { ConnectionsSection } from "@/domains/catalog/components/profiles/connections-section";
import {
  DetailSection,
  FactRail,
  FactTile,
  SurfaceBlock,
  formatGeoSpecificity,
  formatProfileLocation,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import { ReachSection } from "@/domains/catalog/components/profiles/reach-section";
import { useConnections } from "@/domains/catalog/hooks/use-connections";
import { useEntry } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { humanize } from "@/domains/catalog/catalog";
import { PageLayout } from "@/platform/layout/page-layout";
import { Badge } from "@/platform/ui/badge";
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

  return (
    <PageLayout className="pt-0 pb-12">
      <ProfileJsonLd entry={entry} affiliatedOrg={affiliatedOrgQuery.data} />

      <div className="space-y-10">
        <section className="bg-surface-container -mx-6 border-b border-black/5 px-6 py-6 lg:py-8">
          <div className="mx-auto max-w-[76rem] space-y-6">
            <Link
              to="/profiles/people"
              className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to people
            </Link>

            <div className="space-y-6">
              <div className="flex items-start gap-4 lg:gap-5">
                <ActorAvatar name={entry.name} type="person" size="lg" />
                <div className="min-w-0 space-y-4">
                  <div className="space-y-2">
                    <p className="type-label-medium text-ink-muted">Person profile</p>
                    <h1
                      className="type-display-small text-ink-strong leading-tight"
                      style={{ viewTransitionName: `entry-name-${entry.id}` }}
                    >
                      {entry.name}
                    </h1>
                    {entry.description ? (
                      <p className="type-body-large text-ink-soft max-w-3xl">{entry.description}</p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="info">Person</Badge>
                    {entry.verified ? <Badge variant="success">Verified</Badge> : null}
                    <Badge>{formatGeoSpecificity(entry.geo_specificity)}</Badge>
                  </div>
                </div>
              </div>

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
                <FactTile
                  label="Coverage"
                  value={formatCountSummary(entry.source_count, "source")}
                />
              </FactRail>
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-[76rem] gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <main className="space-y-10">
            <DetailSection eyebrow="Profile" title="What Atlas has surfaced">
              <div className="space-y-5">
                {entry.description ? (
                  <SurfaceBlock>
                    <p className="type-body-large text-ink-soft">{entry.description}</p>
                  </SurfaceBlock>
                ) : null}

                {affiliatedOrgQuery.data ? (
                  <SurfaceBlock>
                    <div className="space-y-3">
                      <p className="type-label-small text-ink-muted tracking-[0.18em] uppercase">
                        Affiliation
                      </p>
                      <Link
                        to="/profiles/organizations/$slug"
                        params={{ slug: affiliatedOrgQuery.data.slug }}
                        className="bg-surface-container-low hover:bg-surface-container-high flex items-center gap-4 rounded-[1rem] px-4 py-4 transition-colors"
                      >
                        <ActorAvatar
                          name={affiliatedOrgQuery.data.name}
                          type="organization"
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="type-title-medium text-ink-strong">
                            {affiliatedOrgQuery.data.name}
                          </p>
                          <p className="type-body-medium text-ink-muted">
                            {formatProfileLocation(affiliatedOrgQuery.data)}
                          </p>
                        </div>
                        <ArrowUpRight className="text-ink-muted h-4 w-4 shrink-0" />
                      </Link>
                    </div>
                  </SurfaceBlock>
                ) : null}

                {focusLabels.length > 0 ? (
                  <div className="space-y-3">
                    <p className="type-label-small text-ink-muted tracking-[0.18em] uppercase">
                      Issue focus
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {focusLabels.map((label) => (
                        <Badge key={label} className="bg-surface-container-high text-ink-strong">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </DetailSection>

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
          </main>

          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            {hasReach ? (
              <SurfaceBlock>
                <ReachSection email={entry.email} website={entry.website} phone={entry.phone} />
              </SurfaceBlock>
            ) : null}

            <SurfaceBlock>
              <ConnectionsSection
                connections={connectionsQuery.data ?? []}
                isLoading={connectionsQuery.isLoading}
              />
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
