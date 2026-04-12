import type { ReactNode } from "react";
import { Badge } from "@/platform/ui/badge";
import { ActorAvatar } from "./actor-avatar";

type ProfileType = "person" | "organization";

interface ProfileHeaderProps {
  type: ProfileType;
  name: string;
  avatarName: string;
  photoUrl?: string;
  verified: boolean;
  sourceCount: number;
  subtitle?: ReactNode;
  location: string;
  geoSpecificity: string;
  additionalBadges?: ReactNode;
}

function humanizeGeoSpecificity(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ProfileHeader({
  type,
  name,
  avatarName,
  photoUrl,
  verified,
  sourceCount,
  subtitle,
  location,
  geoSpecificity,
  additionalBadges,
}: ProfileHeaderProps) {
  return (
    <div className="rounded-t-3xl bg-[var(--ink-strong)] px-6 py-6 text-white">
      <div className="flex items-center justify-between">
        <span className="type-label-small tracking-widest text-white/50 uppercase">{type}</span>
        <div className="flex items-center gap-2">
          {verified ? (
            <Badge className="border-0 bg-[var(--accent)] text-white">Verified</Badge>
          ) : null}
          <Badge className="border-0 bg-white/10 text-white/70">
            {sourceCount} {sourceCount === 1 ? "source" : "sources"}
          </Badge>
          {additionalBadges}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <ActorAvatar name={avatarName} type={type} size="lg" photoUrl={photoUrl} />
        <div className="min-w-0">
          <h1 className="text-[22px] leading-7 font-bold" style={{ letterSpacing: "-0.01em" }}>
            {name}
          </h1>
          {subtitle ? <div className="mt-1 text-white/60">{subtitle}</div> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="type-label-small inline-block rounded-full bg-white/10 px-3 py-1 text-white/60">
          {location}
        </span>
        <span className="type-label-small inline-block rounded-full bg-white/10 px-3 py-1 text-white/60">
          {humanizeGeoSpecificity(geoSpecificity)}
        </span>
      </div>
    </div>
  );
}
