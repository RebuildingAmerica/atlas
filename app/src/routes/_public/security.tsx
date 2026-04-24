import { createFileRoute } from "@tanstack/react-router";
import { SecurityPage } from "@/platform/pages/security-page";

export const Route = createFileRoute("/_public/security")({
  component: SecurityPage,
});
