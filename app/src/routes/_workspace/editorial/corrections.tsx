import { createFileRoute } from "@tanstack/react-router";
import { CorrectionInboxPage } from "@/domains/editorial/correction-inbox-page";

export const Route = createFileRoute("/_workspace/editorial/corrections")({
  head: () => ({ meta: [{ title: "Correction inbox | Atlas editorial" }] }),
  component: CorrectionInboxPage,
});
