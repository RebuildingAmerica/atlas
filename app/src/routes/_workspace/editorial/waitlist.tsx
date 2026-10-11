import { createFileRoute } from "@tanstack/react-router";
import { WaitlistAdminPage } from "@/domains/waitlist/pages/waitlist-admin-page";
import { loadWaitlistStaffAccess } from "@/domains/waitlist/waitlist.functions";
export const Route = createFileRoute("/_workspace/editorial/waitlist")({
  beforeLoad: () => loadWaitlistStaffAccess(),
  head: () => ({
    meta: [{ title: "Waitlist | Atlas admin" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  headers: () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }),
  component: WaitlistAdminPage,
});
