import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Bell } from "lucide-react";
import { z } from "zod";
import { PageLayout } from "@/platform/layout/page-layout";
import { Badge } from "@/platform/ui/badge";

const claimSearchSchema = z.object({
  from: z.string().optional(),
});

export const Route = createFileRoute("/_public/claim")({
  validateSearch: claimSearchSchema,
  component: ClaimRoute,
});

const NOTIFY_EMAIL = "claims@rebuildingus.org";

function ClaimRoute() {
  const { from } = Route.useSearch();
  const subject = "Notify me when profile claiming is live";
  const body = from
    ? `Please notify me when I can claim my Atlas profile. The profile I want to claim is here: https://rebuildingus.org${from}`
    : "Please notify me when I can claim my Atlas profile.";
  const mailto = `mailto:${NOTIFY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <PageLayout className="pt-0 pb-12">
      <div className="mx-auto max-w-2xl space-y-8 py-12">
        <Link
          to="/profiles"
          className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to profiles
        </Link>

        <div className="space-y-3">
          <Badge variant="info">Coming soon</Badge>
          <h1 className="type-display-small text-ink-strong">Claim your profile</h1>
          <p className="type-body-large text-ink-soft">
            Atlas surfaces civic actors from public sources. Soon, the people and organizations we
            cover will be able to claim their profiles, verify what we have, and manage what gets
            surfaced — much like Google Scholar.
          </p>
        </div>

        <div className="bg-surface-container space-y-4 rounded-[1rem] p-6">
          <div className="flex items-start gap-3">
            <Bell className="text-accent mt-1 h-5 w-5 shrink-0" aria-hidden />
            <div className="space-y-2">
              <h2 className="type-title-medium text-ink-strong">Get notified when it’s live</h2>
              <p className="type-body-medium text-ink-soft">
                We’re building the verification flow now. Drop us a line and we’ll reach out as soon
                as you can claim your profile.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={mailto}
              className="type-label-large bg-primary inline-flex items-center gap-2 rounded-full px-5 py-2 font-semibold text-white transition-colors hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
            >
              Email us
            </a>
            {from ? (
              <a
                href={from}
                className="type-label-large border-outline-variant bg-surface-container-lowest text-on-surface hover:border-outline hover:bg-surface-container-high inline-flex items-center gap-2 rounded-full border px-5 py-2 font-medium transition-colors"
              >
                Back to the profile
              </a>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="type-title-medium text-ink-strong">What you’ll be able to do</h3>
          <ul className="type-body-medium text-ink-soft list-disc space-y-1 pl-5">
            <li>Verify the basics about you (role, location, contact channels).</li>
            <li>Add a photo and write a custom bio that replaces the auto-generated one.</li>
            <li>Hide specific sources from the public view if they don’t represent your work.</li>
            <li>Choose how readers should reach you when they want to get in touch.</li>
          </ul>
        </div>

        <p className="type-body-small text-ink-muted">
          Atlas remains the source of record. Even after a claim, the underlying data stays
          source-linked and traceable — claiming controls what’s surfaced publicly, not what we
          know.
        </p>
      </div>
    </PageLayout>
  );
}
