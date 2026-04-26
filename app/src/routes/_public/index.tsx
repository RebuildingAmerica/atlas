import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/platform/pages/home-page";

export const Route = createFileRoute("/_public/")({
  ssr: false,
  component: HomePage,
});
