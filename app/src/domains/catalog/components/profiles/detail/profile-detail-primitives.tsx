import type { ReactNode } from "react";
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
