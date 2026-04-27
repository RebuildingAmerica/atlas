import { Link } from "@tanstack/react-router";
import { Newspaper } from "lucide-react";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { AvatarRow } from "@/domains/catalog/components/profiles/avatar-row";
import { DataQualityBlock } from "@/domains/catalog/components/profiles/data-quality-block";
import {
  DetailSection,
  FactRail,
  FactTile,
  SurfaceBlock,
  formatProfileLocation,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { IssueFootprint } from "@/domains/catalog/components/profiles/issue-footprint";
import { NetworkRails } from "@/domains/catalog/components/profiles/network-rails";
import { PresenceSection } from "@/domains/catalog/components/profiles/presence-section";
import { ProfileHero } from "@/domains/catalog/components/profiles/profile-hero";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import { WorkSection } from "@/domains/catalog/components/profiles/work-section";
import { useConnections } from "@/domains/catalog/hooks/use-connections";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { PageLayout } from "@/platform/layout/page-layout";
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

  const factRail = (
    <FactRail>
      <FactTile label="Geography" value={formatProfileLocation(entry)} />
      <FactTile
        label="People tied"
        value={formatCountSummary(affiliatedPeople.length, "person", "people")}
      />
      <FactTile label="Issue areas" value={formatCountSummary(entry.issue_areas.length, "area")} />
      <FactTile label="Coverage" value={formatCountSummary(entry.source_count, "source")} />
    </FactRail>
  );

  return (
    <PageLayout className="pt-0 pb-12">
      <ProfileJsonLd entry={entry} affiliatedPeople={affiliatedPeople} />

      <div className="space-y-10">
        <ProfileHero
          entry={entry}
          eyebrow="Organization profile"
          backLink={{ to: "/profiles/organizations", label: "Back to organizations" }}
          factRail={factRail}
        />

        <div className="mx-auto grid max-w-[76rem] gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <main className="space-y-10">
            <WorkSection entry={entry} issueAreaLabels={issueAreaLabels} showIssueChips={false} />

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

            <DetailSection eyebrow="Network · the portal" title="Who else is doing this work">
              <NetworkRails
                entry={entry}
                connections={connectionsQuery.data ?? []}
                isLoading={connectionsQuery.isLoading}
              />
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
              <DataQualityBlock entry={entry} />
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
