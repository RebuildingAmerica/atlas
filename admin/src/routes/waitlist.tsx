import { createFileRoute } from "@tanstack/react-router";
import { WaitlistAdminPage } from "@/domains/waitlist/pages/waitlist-admin-page";
export const Route = createFileRoute("/waitlist")({
  head: () => ({
    meta: [
      { title: "Waitlist | Atlas platform admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  }),
  component: WaitlistAdminPage,
});
