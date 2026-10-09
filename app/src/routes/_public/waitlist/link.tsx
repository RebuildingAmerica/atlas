import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { WaitlistLinkPage } from "@/domains/waitlist/pages/waitlist-link-page";

export const Route = createFileRoute("/_public/waitlist/link")({
  validateSearch: z.object({
    token: z.string().min(1).max(100),
    kind: z.enum(["confirm", "manage", "invite"]),
  }),
  head: () => ({
    meta: [
      { title: "Your waitlist request | Atlas" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }),
  component: LinkRoute,
});
function LinkRoute() {
  const search = Route.useSearch();
  return <WaitlistLinkPage token={search.token} kind={search.kind} />;
}
