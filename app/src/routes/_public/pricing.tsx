import { createFileRoute, redirect } from "@tanstack/react-router";
import { PricingPage } from "@/domains/billing/pages/pricing-page";
import { getAtlasSession } from "@/domains/access/session.functions";

export const Route = createFileRoute("/_public/pricing")({
  beforeLoad: async () => {
    const session = await getAtlasSession();
    if (session?.isLocal) {
      throw redirect({ to: "/" });
    }
  },
  component: PricingPage,
});
