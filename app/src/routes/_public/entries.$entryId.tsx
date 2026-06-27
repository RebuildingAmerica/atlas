/**
 * Legacy entry detail route — redirects to canonical profile URLs.
 *
 * /entries/:id → 301 → /profiles/people/:slug or /profiles/organizations/:slug
 *
 * Initiative, campaign, and event entries now redirect to their own
 * source-linked detail pages.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "@/lib/api";
import type { EntryType } from "@/types";

interface DetailRedirectTarget {
  to: string;
}

const detailRedirects = {
  person: { to: "/profiles/people/$slug" },
  organization: { to: "/profiles/organizations/$slug" },
  initiative: { to: "/profiles/initiatives/$slug" },
  campaign: { to: "/profiles/campaigns/$slug" },
  event: { to: "/profiles/events/$slug" },
} satisfies Record<EntryType, DetailRedirectTarget>;

export const Route = createFileRoute("/_public/entries/$entryId")({
  loader: async ({ params }) => {
    const entry = await api.entries.get(params.entryId);

    if (entry.slug) {
      const target = detailRedirects[entry.type];
      throw redirect({
        to: target.to,
        params: { slug: entry.slug },
        statusCode: 301,
      });
    }

    throw redirect({ to: "/browse", statusCode: 302 });
  },
  component: () => null,
});
