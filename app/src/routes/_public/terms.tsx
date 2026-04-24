import { createFileRoute } from "@tanstack/react-router";
import { TermsPage } from "@/platform/pages/terms-page";

export const Route = createFileRoute("/_public/terms")({
  component: TermsPage,
});
