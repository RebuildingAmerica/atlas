import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AccountNoticeProps {
  children: ReactNode;
  tone: "error" | "secret" | "success";
  title?: string;
}

export function AccountNotice({ children, title, tone }: AccountNoticeProps) {
  const toneClassName =
    tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-950"
      : tone === "secret"
        ? "border-border bg-surface-container-lowest text-ink-strong"
        : "border-emerald-200 bg-emerald-50 text-emerald-950";

  return (
    <div className={cn("rounded-lg border px-4 py-3", toneClassName)}>
      {title ? <p className="type-title-small mb-1">{title}</p> : null}
      <div className="type-body-medium break-words">{children}</div>
    </div>
  );
}
