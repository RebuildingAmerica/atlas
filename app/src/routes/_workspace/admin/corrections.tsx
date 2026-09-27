import { createFileRoute } from "@tanstack/react-router";
import { CorrectionInboxPage } from "@/domains/admin/correction-inbox-page";

export const Route = createFileRoute("/_workspace/admin/corrections")({
  component: CorrectionInboxPage,
});
