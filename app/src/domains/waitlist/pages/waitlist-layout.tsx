import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { PageLayout } from "@rebuildingamerica/atlas-ui/layout/page-layout";

interface WaitlistLayoutProps {
  children: ReactNode;
  showBrowseLink?: boolean;
}
export function WaitlistLayout({ children, showBrowseLink = true }: WaitlistLayoutProps) {
  return (
    <div className="bg-surface-container-lowest flex flex-1 flex-col">
      <PageLayout className="min-h-[calc(100svh-5rem)] py-10 sm:py-16">
        <div className="mx-auto w-full max-w-lg space-y-6">
          {children}
          {showBrowseLink ? <WaitlistFooter /> : null}
        </div>
      </PageLayout>
    </div>
  );
}
export const waitlistFooterActionClass =
  "type-label-medium text-ink-soft hover:text-ink-strong focus-visible:ring-accent inline-flex min-h-11 items-center gap-2 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-offset-4";
export function WaitlistFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <Link to="/browse" className={waitlistFooterActionClass}>
        Browse Atlas
      </Link>
      {children}
    </footer>
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
