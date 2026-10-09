import type { ReactNode } from "react";
import { PageLayout } from "@rebuildingamerica/atlas-ui/layout/page-layout";

interface WaitlistLayoutProps {
  children: ReactNode;
}
export function WaitlistLayout({ children }: WaitlistLayoutProps) {
  return (
    <div className="bg-surface flex flex-1 flex-col">
      <PageLayout className="min-h-[calc(100svh-5rem)] py-10 sm:py-16">
        <div className="mx-auto w-full max-w-lg space-y-6">{children}</div>
      </PageLayout>
    </div>
  );
}
export const waitlistSecondaryActionClass =
  "type-label-medium text-ink-soft hover:text-ink-strong focus-visible:ring-accent inline-flex min-h-11 items-center gap-2 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-offset-4";
export const waitlistHeadingClass =
  "text-ink-strong font-serif text-4xl leading-tight tracking-tight text-balance sm:text-5xl";
export const waitlistTextLinkClass =
  "type-label-large text-accent-deep hover:text-ink-strong focus-visible:ring-accent inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-offset-4";
export const waitlistPrimaryLinkClass =
  "type-label-large bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary-container focus-visible:ring-primary inline-flex min-h-12 items-center justify-center rounded-full px-6 py-3 text-center outline-none focus-visible:ring-2 focus-visible:ring-offset-4";
export const waitlistSummaryClass =
  "type-label-large focus-visible:ring-accent cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-4";
export const waitlistFieldClass =
  "border-border bg-surface text-ink-strong focus-visible:ring-accent w-full rounded-xl border px-3 py-3 outline-none focus-visible:ring-2";
export function WaitlistError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="type-body-medium text-ink-strong break-words">
      {message}
    </p>
  ) : null;
}
