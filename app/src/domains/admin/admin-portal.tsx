import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type AdminIndicatorTone = "pass" | "warn" | "block" | "neutral";

interface AdminPageShellProps {
  children: ReactNode;
}

interface AdminPageHeaderProps {
  badge: string;
  children?: ReactNode;
  description: string;
  title: string;
}

interface AdminIndicatorCardProps {
  detail: ReactNode;
  label: string;
  tone: AdminIndicatorTone;
  value: string;
}

interface AdminIndicatorPlaceholderCardProps {
  detail: ReactNode;
  label: string;
}

export function AdminPageShell({ children }: AdminPageShellProps) {
  return <div className="mx-auto max-w-6xl space-y-6 py-2">{children}</div>;
}

export function AdminPageHeader({ badge, children, description, title }: AdminPageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <AdminStatusBadge tone="neutral">{badge}</AdminStatusBadge>
        <h1 className="type-display-small text-ink-strong">{title}</h1>
        <p className="type-body-medium text-ink-soft max-w-2xl">{description}</p>
      </div>
      {children}
    </header>
  );
}

export function AdminIndicatorCard({ detail, label, tone, value }: AdminIndicatorCardProps) {
  return (
    <article className="border-border bg-surface-container-lowest rounded-lg border p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="type-label-small text-ink-muted">{label}</p>
        <AdminStatusDot tone={tone} />
      </div>
      <p className="type-title-large text-ink-strong mt-2">{value}</p>
      <div className="type-body-small text-ink-soft mt-2">{detail}</div>
    </article>
  );
}

export function AdminIndicatorPlaceholderCard({
  detail,
  label,
}: AdminIndicatorPlaceholderCardProps) {
  return <AdminIndicatorCard label={label} value="-" detail={detail} tone="neutral" />;
}

export function AdminInlineStatus({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p className="type-body-small text-ink-soft" aria-live="polite">
      {message}
    </p>
  );
}

export function AdminStatusBadge({
  children,
  compact = false,
  tone,
}: {
  children: ReactNode;
  compact?: boolean;
  tone: AdminIndicatorTone;
}) {
  return (
    <span
      className={cn(
        "type-label-small inline-flex rounded-full border px-2.5 py-1",
        tone === "pass" && "border-emerald-200 bg-emerald-50 text-emerald-800",
        tone === "warn" && "border-yellow-200 bg-yellow-50 text-yellow-800",
        tone === "block" && "border-red-200 bg-red-50 text-red-800",
        tone === "neutral" && "border-border bg-surface-container text-ink-soft",
        compact && "px-2 py-0.5",
      )}
    >
      {children}
    </span>
  );
}

function AdminStatusDot({ tone }: { tone: AdminIndicatorTone }) {
  return (
    <span
      className={cn(
        "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
        tone === "pass" && "bg-emerald-500",
        tone === "warn" && "bg-yellow-500",
        tone === "block" && "bg-red-500",
        tone === "neutral" && "bg-outline-variant",
      )}
      aria-hidden
    />
  );
}
