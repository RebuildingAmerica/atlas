import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AccountSectionProps {
  children: ReactNode;
  id: string;
  title: string;
}

export function AccountSection({ children, id, title }: AccountSectionProps) {
  return (
    <section id={id} className="scroll-mt-28">
      <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
        <div className="min-w-0">
          <h2 className="type-title-large text-ink-strong">{title}</h2>
        </div>
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </section>
  );
}

interface AccountSubsectionProps {
  children: ReactNode;
  title: string;
}

export function AccountSubsection({ children, title }: AccountSubsectionProps) {
  return (
    <div className="space-y-3">
      <h3 className="type-title-medium text-ink-strong">{title}</h3>
      {children}
    </div>
  );
}

interface AccountSurfaceProps {
  children: ReactNode;
  className?: string;
}

export function AccountSurface({ children, className }: AccountSurfaceProps) {
  return (
    <div
      className={cn(
        "border-border bg-surface-container-lowest divide-border divide-y overflow-hidden rounded-lg border shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface AccountRowProps {
  action?: ReactNode;
  children?: ReactNode;
  label: string;
  value?: ReactNode;
}

export function AccountRow({ action, children, label, value }: AccountRowProps) {
  return (
    <div className="grid gap-2 px-4 py-3.5 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-center">
      <p className="type-label-large text-ink-soft">{label}</p>
      <div className="type-body-medium text-ink-strong min-w-0 break-words">
        {children ?? value}
      </div>
      {action ? <div className="flex justify-start sm:justify-end">{action}</div> : null}
    </div>
  );
}
