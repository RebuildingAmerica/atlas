import { Badge } from "@/platform/ui/badge";
import type { Entry } from "@/types";
import { AppearancesList } from "./appearances-list";
import { AvatarRow } from "./avatar-row";
import { IssueFootprint } from "./issue-footprint";
import { PresenceSection } from "./presence-section";
import { ProfileHeader } from "./profile-header";

interface OrgProfileProps {
  entry: Entry;
  issueAreaLabels?: Record<string, string>;
  affiliatedPeople?: Entry[];
}

function formatLocation(entry: Entry): string {
  if (entry.city && entry.state) {
    return `${entry.city}, ${entry.state}`;
  }
  if (entry.region) {
    return entry.region;
  }
  return entry.state ?? "Location not specified";
}

export function OrgProfile({
  entry,
  issueAreaLabels = {},
  affiliatedPeople = [],
}: OrgProfileProps) {
  const activeBadge = entry.active ? (
    <Badge variant="success" className="border-0">
      Active
    </Badge>
  ) : null;

  return (
    <div className="border-border shadow-soft overflow-hidden rounded-3xl border">
      <ProfileHeader
        entryId={entry.id}
        type="organization"
        name={entry.name}
        avatarName={entry.name}
        verified={entry.verified}
        sourceCount={entry.source_count}
        location={formatLocation(entry)}
        geoSpecificity={entry.geo_specificity}
        additionalBadges={activeBadge}
      />

      <div className="bg-surface space-y-6 px-6 py-6">
        {/* Mission */}
        {entry.description ? (
          <div className="space-y-2">
            <p className="type-label-small text-ink-muted tracking-widest uppercase">Mission</p>
            <p className="type-body-large text-ink-soft">{entry.description}</p>
          </div>
        ) : null}

        {/* Issue footprint */}
        {entry.issue_areas.length > 0 ? (
          <IssueFootprint issueAreas={entry.issue_areas} issueAreaLabels={issueAreaLabels} />
        ) : null}

        {/* People */}
        {affiliatedPeople.length > 0 ? <AvatarRow people={affiliatedPeople} /> : null}

        {/* Presence */}
        <PresenceSection
          website={entry.website}
          email={entry.email}
          phone={entry.phone}
          firstSeen={entry.first_seen}
        />

        {/* Appearances & coverage */}
        <AppearancesList sources={entry.sources ?? []} mode="organization" />
      </div>
    </div>
  );
}
