/**
 * ProfileHero — full-width identity + action block for profile pages.
 *
 * Composes ActorAvatar, an identity block (name, description, status badges,
 * freshness), the ActionCluster, and a caller-provided fact rail. Person and
 * organization variants share this shell; the differences (eyebrow, fact tiles,
 * badge set) are passed in as props/slots.
 */
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { ActionCluster } from "@/domains/catalog/components/profiles/action-cluster";
import {
  FreshnessChip,
  formatGeoSpecificity,
  formatProfileLocation,
} from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import { Badge } from "@/platform/ui/badge";
import type { Entry } from "@/types";

type BackLinkTo = "/profiles/people" | "/profiles/organizations";

interface ProfileHeroProps {
  entry: Entry;
  eyebrow: string;
  backLink: { to: BackLinkTo; label: string };
  factRail: ReactNode;
}

function ProfileTypeBadgeLabel({ type }: { type: Entry["type"] }) {
  switch (type) {
    case "person":
      return "Person";
    case "organization":
      return "Organization";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

export function ProfileHero({ entry, eyebrow, backLink, factRail }: ProfileHeroProps) {
  const avatarType = entry.type === "organization" ? "organization" : "person";
  const freshnessSource = entry.latest_source_date ?? entry.last_seen;
  const shareUrl =
    typeof window !== "undefined"
      ? window.location.href
      : `https://rebuildingus.org/profiles/${avatarType === "organization" ? "organizations" : "people"}/${entry.slug}`;

  return (
    <section className="bg-surface-container -mx-6 border-b border-black/5 px-6 py-6 lg:py-8">
      <div className="mx-auto max-w-[76rem] space-y-6">
        <Link
          to={backLink.to}
          className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLink.label}
        </Link>

        <div className="space-y-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4 lg:gap-5">
              <ActorAvatar name={entry.name} type={avatarType} size="lg" />
              <div className="min-w-0 space-y-3">
                <div className="space-y-2">
                  <p className="type-label-medium text-ink-muted">{eyebrow}</p>
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
                  <Badge variant="info">
                    <ProfileTypeBadgeLabel type={entry.type} />
                  </Badge>
                  {entry.verified ? <Badge variant="success">Verified</Badge> : null}
                  {avatarType === "organization" && entry.active ? (
                    <Badge variant="success">Active</Badge>
                  ) : null}
                  <Badge>{formatGeoSpecificity(entry.geo_specificity)}</Badge>
                  <FreshnessChip isoDate={freshnessSource} />
                  <span className="type-label-small text-ink-muted">
                    · {formatProfileLocation(entry)}
                  </span>
                </div>
              </div>
            </div>

            <div className="lg:flex lg:flex-col lg:items-end lg:gap-2">
              <ActionCluster shareUrl={shareUrl} shareTitle={entry.name} email={entry.email} />
            </div>
          </div>

          {factRail}
        </div>
      </div>
    </section>
  );
}
