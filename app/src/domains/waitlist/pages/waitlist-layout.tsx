import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { PageLayout } from "@rebuildingamerica/atlas-ui/layout/page-layout";

export function WaitlistLayout({ children }: { children: ReactNode }) {
  return (
    <PageLayout className="py-8 sm:py-12">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <div className="border-border bg-surface-container-lowest rounded-3xl border p-6 sm:p-10">
          {children}
        </div>
        <Link to="/browse" className={waitlistTextLinkClass}>
          Browse Atlas
        </Link>
      </div>
    </PageLayout>
  );
}
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
