/**
 * ClaimBanner — full-width banner above the profile hero offering a claim CTA.
 *
 * Renders only for unverified profiles. The CTA routes to `/claim` with a
 * `from` query param so the future claim flow can pre-populate the actor in
 * context.
 */
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { Entry } from "@/types";

interface ClaimBannerProps {
  entry: Entry;
}

function profilePathFor(entry: Entry): string {
  const segment = entry.type === "organization" ? "organizations" : "people";
  return `/profiles/${segment}/${entry.slug}`;
}

export function ClaimBanner({ entry }: ClaimBannerProps) {
  if (entry.verified) {
    return null;
  }

  const subjectName = entry.name;
  const profilePath = profilePathFor(entry);

  return (
    <section className="-mx-6 border-b border-amber-200/60 bg-amber-50/70 px-6 py-3">
      <div className="mx-auto flex max-w-[76rem] flex-wrap items-center justify-between gap-3">
        <p className="type-body-medium text-amber-900">
          <span className="font-semibold">Are you {subjectName}?</span>{" "}
          <span className="text-amber-800">
            Claim this profile to verify your information and manage what’s surfaced.
          </span>
        </p>
        <Link
          to="/claim"
          search={{ from: profilePath }}
          className="type-label-medium inline-flex items-center gap-1.5 rounded-full bg-amber-900 px-3 py-1.5 font-semibold text-white transition-colors hover:bg-amber-800 focus:ring-2 focus:ring-amber-700 focus:ring-offset-2 focus:ring-offset-amber-50 focus:outline-none"
        >
          Claim profile
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}
