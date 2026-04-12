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
    <div className="overflow-hidden rounded-3xl border border-[var(--border)] shadow-[var(--shadow-soft)]">
      <ProfileHeader
        type="person"
        name={entry.name}
        avatarName={entry.name}
        verified={entry.verified}
        sourceCount={entry.source_count}
        subtitle={subtitle ? <span className="type-body-medium">{subtitle}</span> : undefined}
        location={formatLocation(entry)}
        geoSpecificity={entry.geo_specificity}
      />

      <div className="space-y-6 bg-[var(--surface)] px-6 py-6">
        {/* About */}
        {entry.description ? (
          <div className="space-y-2">
            <p className="type-label-small tracking-widest text-[var(--ink-muted)] uppercase">
              About
            </p>
            <p className="type-body-large text-[var(--ink-soft)]">{entry.description}</p>
          </div>
        ) : null}

        {/* Issue focus */}
        {entry.issue_areas.length > 0 ? (
          <div className="space-y-2">
            <p className="type-label-small tracking-widest text-[var(--ink-muted)] uppercase">
              Issue focus
            </p>
            <div className="flex flex-wrap gap-2">
              {entry.issue_areas.map((area) => (
                <span
                  key={area}
                  className="type-label-medium inline-block rounded-full bg-[var(--accent-soft)] px-3 py-1 font-semibold text-[var(--accent-ink)]"
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
            <p className="type-label-small tracking-widest text-[var(--ink-muted)] uppercase">
              Organization
            </p>
            <Link
              to="/entries/$entryId"
              params={{ entryId: affiliatedOrg.id }}
              className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-container-lowest)] p-4 transition-colors hover:bg-[var(--surface-container-low)]"
            >
              <ActorAvatar name={affiliatedOrg.name} type="organization" size="md" />
              <div className="min-w-0 flex-1">
                <p className="type-title-small text-[var(--ink-strong)]">{affiliatedOrg.name}</p>
                <p className="type-body-small text-[var(--ink-muted)]">
                  {formatLocation(affiliatedOrg)}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-[var(--ink-muted)]" />
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
