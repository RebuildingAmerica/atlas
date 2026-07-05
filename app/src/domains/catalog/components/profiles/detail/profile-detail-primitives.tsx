import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Entry } from "@/types";

export function formatProfileLocation(entry: Entry): string {
  if (entry.city && entry.state) {
    return `${entry.city}, ${entry.state}`;
  }

  if (entry.region) {
    return entry.region;
  }

  return entry.state ?? "Location not specified";
}

export function formatGeoSpecificity(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export type FreshnessStatus = "fresh" | "aging" | "stale";

export interface FreshnessInfo {
  status: FreshnessStatus;
  label: string;
  daysAgo: number;
}

const MS_PER_DAY = 86_400_000;
const FRESH_DAYS = 30;
const AGING_DAYS = 180;

export function formatFreshness(isoDate: string, now: Date = new Date()): FreshnessInfo {
  const then = new Date(isoDate);
  const daysAgo = Math.max(0, Math.floor((now.getTime() - then.getTime()) / MS_PER_DAY));

  let label: string;
  if (daysAgo === 0) {
    label = "today";
  } else if (daysAgo === 1) {
    label = "yesterday";
  } else if (daysAgo < 7) {
    label = `${daysAgo}d ago`;
  } else if (daysAgo < 60) {
    const weeks = Math.round(daysAgo / 7);
    label = `${weeks}w ago`;
  } else if (daysAgo < 730) {
    const months = Math.round(daysAgo / 30);
    label = `${months}mo ago`;
  } else {
    const years = Math.floor(daysAgo / 365);
    label = `${years}y+ ago`;
  }

  let status: FreshnessStatus;
  if (daysAgo <= FRESH_DAYS) {
    status = "fresh";
  } else if (daysAgo <= AGING_DAYS) {
    status = "aging";
  } else {
    status = "stale";
  }

  return { status, label, daysAgo };
}

const FRESHNESS_DOT_CLASS: Record<FreshnessStatus, string> = {
  fresh: "bg-emerald-500",
  aging: "bg-amber-500",
  stale: "bg-rose-500",
};

export function FreshnessChip({
  isoDate,
  prefix = "Last seen",
  className,
}: {
  isoDate: string;
  prefix?: string;
  className?: string;
}) {
  const { status, label } = formatFreshness(isoDate);

  return (
    <span
      className={cn(
        "type-label-small text-ink-soft bg-surface-container-low inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5",
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", FRESHNESS_DOT_CLASS[status])} aria-hidden />
      {prefix} {label}
    </span>
  );
}

export function DetailSection({
  children,
  eyebrow,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <p className="type-label-medium text-ink-muted">{eyebrow}</p>
        <h2 className="type-headline-small text-ink-strong">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function SurfaceBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("bg-surface-container rounded-[1rem] px-5 py-5 lg:px-6", className)}>
      {children}
    </section>
  );
}

interface ProfileSectionProps {
  children: ReactNode;
  className?: string;
  htmlId?: string;
  Icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  sectionId: string;
  title?: string;
}

export function ProfileSection({
  children,
  className,
  htmlId,
  Icon,
  label,
  sectionId,
  title,
}: ProfileSectionProps) {
  return (
    <section
      aria-label={label}
      className={cn(
        "border-border-taupe bg-surface-container-lowest border-t px-6 py-6 sm:px-8",
        className,
      )}
      data-profile-section={sectionId}
      id={htmlId}
    >
      <div
        className="border-border/70 -mx-6 -mt-6 mb-5 flex items-center gap-2 border-b px-6 py-3 sm:-mx-8 sm:px-8"
        data-profile-section-header="true"
      >
        {Icon ? <Icon className="text-civic h-4 w-4 shrink-0" aria-hidden /> : null}
        <div className="min-w-0">
          {title ? (
            <p className="type-label-small text-ink-muted tracking-widest uppercase">{label}</p>
          ) : (
            <h2 className="type-label-small text-ink-muted tracking-widest uppercase">{label}</h2>
          )}
          {title ? <h2 className="type-title-medium text-ink-strong">{title}</h2> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function FactRail({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface-container-high overflow-hidden rounded-[1.25rem]">
      <div className="grid gap-px md:grid-cols-2 xl:grid-cols-4">{children}</div>
    </div>
  );
}

export function FactTile({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-surface-container px-4 py-3", className)}>
      <p className="type-label-medium text-ink-muted">{label}</p>
      <div className="type-body-medium text-ink-strong mt-1.5">{value}</div>
    </div>
  );
}
