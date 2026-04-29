/**
 * ProfileHero — editorial identity panel for profile pages.
 *
 * Pairs a typographic name (Public Sans 800) with a role + place subtitle and
 * a real subject photo when one is on file. The ident bar sits on top of the
 * same bordered container so the two read as one unit, with a single outer
 * border separating the hero from the rest of the page.
 */
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { ProfileIdentBar } from "@/domains/catalog/components/profiles/profile-ident-bar";
import { formatProfileLocation } from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import type { Entry } from "@/types";

interface ProfileHeroProps {
  entry: Entry;
  affiliation?: { name: string; href: string };
}

function describeActiveStatus(entry: Entry): string {
  if (entry.geo_specificity === "national") return "Active nationally";
  if (entry.geo_specificity === "statewide") return "Active statewide";
  if (entry.geo_specificity === "regional") return "Active regionally";
  return "Active locally";
}

export function ProfileHero({ entry, affiliation }: ProfileHeroProps) {
  const avatarType = entry.type === "organization" ? "organization" : "person";
  const showAvatar = Boolean(entry.photo_url);
  const subtitleParts: string[] = [];
  if (affiliation) subtitleParts.push(affiliation.name);
  if (entry.type === "organization" && entry.geo_specificity) {
    subtitleParts.push(describeActiveStatus(entry));
  }

  return (
    <div className="border-border-taupe overflow-hidden border">
      <ProfileIdentBar entry={entry} />

      <section
        className="bg-surface-container-lowest px-6 py-8 sm:px-8 sm:py-10"
        aria-labelledby={`profile-name-${entry.id}`}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
          {showAvatar ? (
            <ActorAvatar name={entry.name} type={avatarType} size="lg" photoUrl={entry.photo_url} />
          ) : null}
          <div className="min-w-0 flex-1 space-y-2">
            <h1
              id={`profile-name-${entry.id}`}
              className="type-editorial-display text-ink-strong"
              style={{ viewTransitionName: `entry-name-${entry.id}` }}
            >
              {entry.name}
            </h1>
            <p className="text-ink-strong text-base font-medium sm:text-lg">
              {entry.type === "organization" ? "Organization" : "Community organizer"}
              {entry.description ? (
                <>
                  <span className="text-ink-soft"> &middot; </span>
                  {entry.description}
                </>
              ) : null}
            </p>
            <p className="text-ink-soft text-sm font-medium">
              Based in{" "}
              <strong className="text-ink-strong font-bold">{formatProfileLocation(entry)}</strong>
              {subtitleParts.length > 0 ? <> &middot; {subtitleParts.join(" · ")}</> : null}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
