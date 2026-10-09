import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { WaitlistPage } from "@/domains/waitlist/pages/waitlist-page";
import { waitlistProductSchema } from "@/domains/waitlist/contracts";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_public/waitlist/")({
  beforeLoad: () => redirectIfLocalSession("/"),
  validateSearch: z.object({
    product: waitlistProductSchema.optional(),
    interval: z.enum(["monthly", "yearly", "four_month", "weekly", "once"]).optional(),
  }),
  head: () => ({
    meta: [
      { title: "Join the waitlist | Atlas" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }),
  component: WaitlistRoute,
});
function WaitlistRoute() {
  const search = Route.useSearch();
  return <WaitlistPage product={search.product} interval={search.interval} />;
}
