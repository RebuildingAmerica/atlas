import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { Entry } from "@/types";
import { ActorAvatar } from "./actor-avatar";
import { AppearancesList } from "./appearances-list";
import { ProfileHeader } from "./profile-header";
import { ReachSection } from "./reach-section";

interface PersonProfileProps {
  entry: Entry;
  issueAreaLabels?: Record<string, string>;
  affiliatedOrg?: Entry;
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

function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function deriveSubtitle(entry: Entry, affiliatedOrg?: Entry): string | undefined {
  if (affiliatedOrg) {
    return affiliatedOrg.name;
  }
  if (entry.description) {
    // Use the first sentence or first 80 chars as a role hint
    const firstSentence = entry.description.split(/[.!?]/)[0];
    if (firstSentence && firstSentence.length <= 80) {
      return firstSentence;
    }
  }
  return undefined;
}

export function PersonProfile({ entry, issueAreaLabels = {}, affiliatedOrg }: PersonProfileProps) {
  const subtitle = deriveSubtitle(entry, affiliatedOrg);

  return (
    <div className="border-border shadow-soft overflow-hidden rounded-3xl border">
      <ProfileHeader
        entryId={entry.id}
        type="person"
        name={entry.name}
        avatarName={entry.name}
        verified={entry.verified}
        sourceCount={entry.source_count}
        subtitle={subtitle ? <span className="type-body-medium">{subtitle}</span> : undefined}
        location={formatLocation(entry)}
        geoSpecificity={entry.geo_specificity}
      />

      <div className="bg-surface space-y-6 px-6 py-6">
        {/* About */}
        {entry.description ? (
          <div className="space-y-2">
            <p className="type-label-small text-ink-muted tracking-widest uppercase">About</p>
            <p className="type-body-large text-ink-soft">{entry.description}</p>
          </div>
        ) : null}

        {/* Issue focus */}
        {entry.issue_areas.length > 0 ? (
          <div className="space-y-2">
            <p className="type-label-small text-ink-muted tracking-widest uppercase">Issue focus</p>
            <div className="flex flex-wrap gap-2">
              {entry.issue_areas.map((area) => (
                <span
                  key={area}
                  className="type-label-medium bg-accent-soft text-accent-ink inline-block rounded-full px-3 py-1 font-semibold"
                >
                  {issueAreaLabels[area] ?? humanize(area)}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* Organization */}
        {affiliatedOrg ? (
          <div className="space-y-2">
            <p className="type-label-small text-ink-muted tracking-widest uppercase">
              Organization
            </p>
            <Link
              to="/entries/$entryId"
              params={{ entryId: affiliatedOrg.id }}
              className="border-border bg-surface-container-lowest hover:bg-surface-container-low flex items-center gap-3 rounded-2xl border p-4 transition-colors"
            >
              <ActorAvatar name={affiliatedOrg.name} type="organization" size="md" />
              <div className="min-w-0 flex-1">
                <p className="type-title-small text-ink-strong">{affiliatedOrg.name}</p>
                <p className="type-body-small text-ink-muted">{formatLocation(affiliatedOrg)}</p>
              </div>
              <ArrowRight className="text-ink-muted h-4 w-4 shrink-0" />
            </Link>
          </div>
        ) : null}

        {/* Reach */}
        <ReachSection email={entry.email} website={entry.website} phone={entry.phone} />

        {/* Appearances */}
        <AppearancesList sources={entry.sources ?? []} mode="person" />
      </div>
    </div>
  );
}
