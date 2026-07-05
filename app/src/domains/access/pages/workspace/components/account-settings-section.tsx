import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AccountSettingsSectionProps {
  children: ReactNode;
  id: string;
  title: string;
}

export function AccountSettingsSection({ children, id, title }: AccountSettingsSectionProps) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <h2 className="type-title-large text-ink-strong">{title}</h2>
      {children}
    </section>
  );
}

interface AccountSettingsSurfaceProps {
  children: ReactNode;
}

export function AccountSettingsSurface({ children }: AccountSettingsSurfaceProps) {
  return (
    <div className="divide-border bg-surface-container-lowest divide-y overflow-hidden rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] ring-1 ring-black/5">
      {children}
    </div>
  );
}

interface AccountSettingsRowProps {
  action?: ReactNode;
  children?: ReactNode;
  label: string;
  value?: ReactNode;
}

export function AccountSettingsRow({ action, children, label, value }: AccountSettingsRowProps) {
  return (
    <div className="grid gap-3 px-4 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center">
      <p className="type-label-large text-ink-soft">{label}</p>
      <div className="type-body-medium text-ink-strong min-w-0 break-words">
        {children ?? value}
      </div>
      {action ? <div className="flex justify-start sm:justify-end">{action}</div> : null}
    </div>
  );
}

interface AccountSettingsNoticeProps {
  children: ReactNode;
  tone: "error" | "secret" | "success";
  title?: string;
}

export function AccountSettingsNotice({ children, title, tone }: AccountSettingsNoticeProps) {
  const toneClassName =
    tone === "error"
      ? "bg-rose-50 text-rose-950"
      : tone === "secret"
        ? "bg-surface-container-lowest text-ink-strong"
        : "bg-emerald-50 text-emerald-950";

  return (
    <div className={cn("rounded-lg px-4 py-3", toneClassName)}>
      {title ? <p className="type-title-small mb-1">{title}</p> : null}
      <div className="type-body-medium break-words">{children}</div>
    </div>
  );
}
