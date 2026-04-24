import { Link } from "@tanstack/react-router";
import { ArrowLeft, Newspaper } from "lucide-react";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { AvatarRow } from "@/domains/catalog/components/profiles/avatar-row";
import { ConnectionsSection } from "@/domains/catalog/components/profiles/connections-section";
import {
  DetailSection,
  FactRail,
  FactTile,
  SurfaceBlock,
  formatGeoSpecificity,
  formatProfileLocation,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { IssueFootprint } from "@/domains/catalog/components/profiles/issue-footprint";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import { PresenceSection } from "@/domains/catalog/components/profiles/presence-section";
import { useConnections } from "@/domains/catalog/hooks/use-connections";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { PageLayout } from "@/platform/layout/page-layout";
import { Badge } from "@/platform/ui/badge";
import type { Entry } from "@/types";

interface OrgProfilePageProps {
  entry: Entry;
}

function formatCountSummary(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function NavigationBlock() {
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
          to="/profiles/organizations"
          className="type-body-medium text-ink-soft hover:text-ink-strong block transition-colors"
        >
          More organizations
        </Link>
        <Link
          to="/profiles/people"
          className="type-body-medium text-ink-soft hover:text-ink-strong block transition-colors"
        >
          People directory
        </Link>
      </div>
    </div>
  );
}

export function OrgProfilePage({ entry }: OrgProfilePageProps) {
  const taxonomyQuery = useTaxonomy();
  const connectionsQuery = useConnections(entry.id);
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

  return (
    <PageLayout className="pt-0 pb-12">
      <ProfileJsonLd entry={entry} affiliatedPeople={affiliatedPeople} />

      <div className="space-y-10">
        <section className="bg-surface-container -mx-6 border-b border-black/5 px-6 py-6 lg:py-8">
          <div className="mx-auto max-w-[76rem] space-y-6">
            <Link
              to="/profiles/organizations"
              className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to organizations
            </Link>

            <div className="space-y-6">
              <div className="flex items-start gap-4 lg:gap-5">
                <ActorAvatar name={entry.name} type="organization" size="lg" />
                <div className="min-w-0 space-y-4">
                  <div className="space-y-2">
                    <p className="type-label-medium text-ink-muted">Organization profile</p>
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
                    <Badge variant="info">Organization</Badge>
                    {entry.verified ? <Badge variant="success">Verified</Badge> : null}
                    {entry.active ? <Badge variant="success">Active</Badge> : null}
                    <Badge>{formatGeoSpecificity(entry.geo_specificity)}</Badge>
                  </div>
                </div>
              </div>

              <FactRail>
                <FactTile label="Geography" value={formatProfileLocation(entry)} />
                <FactTile
                  label="People tied"
                  value={formatCountSummary(affiliatedPeople.length, "person", "people")}
                />
                <FactTile
                  label="Issue areas"
                  value={formatCountSummary(entry.issue_areas.length, "area")}
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
            {entry.issue_areas.length > 0 ? (
              <DetailSection eyebrow="Footprint" title="Issue footprint">
                <SurfaceBlock className="p-4 lg:p-5">
                  <IssueFootprint
                    issueAreas={entry.issue_areas}
                    issueAreaLabels={issueAreaLabels}
                    showLabel={false}
                  />
                </SurfaceBlock>
              </DetailSection>
            ) : null}

            {affiliatedPeople.length > 0 ? (
              <DetailSection eyebrow="People" title="People tied to this organization">
                <SurfaceBlock>
                  <AvatarRow people={affiliatedPeople} showHeader={false} />
                </SurfaceBlock>
              </DetailSection>
            ) : null}

            <DetailSection eyebrow="Evidence" title="Appearances and coverage">
              <SurfaceBlock>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Newspaper className="text-ink-muted h-4 w-4" />
                    <p className="type-body-medium text-ink-soft">
                      Public sources that mention, cite, or document this organization.
                    </p>
                  </div>
                  <AppearancesList sources={entry.sources ?? []} mode="organization" />
                </div>
              </SurfaceBlock>
            </DetailSection>
          </main>

          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            {hasPresence ? (
              <SurfaceBlock>
                <PresenceSection
                  website={entry.website}
                  email={entry.email}
                  phone={entry.phone}
                  firstSeen={entry.first_seen}
                />
              </SurfaceBlock>
            ) : null}

            <SurfaceBlock>
              <ConnectionsSection
                connections={connectionsQuery.data ?? []}
                isLoading={connectionsQuery.isLoading}
              />
            </SurfaceBlock>

            <SurfaceBlock>
              <NavigationBlock />
            </SurfaceBlock>
          </aside>
        </div>
      </div>
    </PageLayout>
  );
}
