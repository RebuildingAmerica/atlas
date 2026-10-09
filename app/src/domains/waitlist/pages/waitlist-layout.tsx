import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { PageLayout } from "@rebuildingamerica/atlas-ui/layout/page-layout";

export function WaitlistLayout({ children }: { children: ReactNode }) {
  return (
    <PageLayout className="py-10 sm:py-16">
      <div className="mx-auto w-full max-w-xl space-y-8">
        <div className="border-border bg-surface-container-lowest rounded-3xl border p-6 sm:p-8">
          {children}
        </div>
        <Link
          to="/browse"
          className="type-label-large text-accent-deep inline-flex underline underline-offset-4"
        >
          Browse Atlas
        </Link>
      </div>
    </PageLayout>
  );
}
export const waitlistFieldClass =
  "border-border bg-surface text-ink-strong focus-visible:ring-accent w-full rounded-xl border px-3 py-3 outline-none focus-visible:ring-2";
export function WaitlistError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="type-body-medium text-ink-strong">
      {message}
    </p>
  ) : null;
}
