import { createFileRoute } from "@tanstack/react-router";
import { WaitlistRequestPage } from "@/domains/waitlist/pages/waitlist-link-page";
export const Route = createFileRoute("/_public/waitlist/request/$id")({
  head: () => ({
    meta: [
      { title: "Your waitlist request | Atlas" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }),
  component: RequestRoute,
});
function RequestRoute() {
  return <WaitlistRequestPage id={Route.useParams().id} />;
}
