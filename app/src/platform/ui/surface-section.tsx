import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

type SurfaceSectionTone = "default" | "plain" | "success";

interface SurfaceSectionProps {
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  marker?: ReactNode;
  title?: ReactNode;
  tone?: SurfaceSectionTone;
}

const TONE_CLASS: Record<SurfaceSectionTone, string> = {
  default: "bg-surface-container",
  plain: "border-outline-variant bg-surface-container-lowest border",
  success: "border border-emerald-200 bg-emerald-50/70",
};

export function SurfaceSection({
  actions,
  children,
  className,
  description,
  icon: Icon,
  marker,
  title,
  tone = "default",
}: SurfaceSectionProps) {
  const hasHeader = Icon || marker || title || description || actions;

  return (
    <section className={cn(TONE_CLASS[tone], "rounded-[1rem] p-5 sm:p-6", className)}>
      {hasHeader ? (
        <div className="mb-4 flex items-start gap-3">
          {marker ? (
            <div className="border-outline-variant bg-surface-container-lowest text-ink-strong flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-semibold">
              {marker}
            </div>
          ) : null}
          {Icon ? <Icon className="text-accent mt-1 h-5 w-5 shrink-0" aria-hidden /> : null}
          <div className="min-w-0 flex-1 space-y-1">
            {title ? <h2 className="type-title-medium text-ink-strong">{title}</h2> : null}
            {description ? <p className="type-body-medium text-ink-soft">{description}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children ? <div className="space-y-4">{children}</div> : null}
    </section>
  );
}
