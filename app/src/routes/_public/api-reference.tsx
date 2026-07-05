import { createFileRoute, redirect } from "@tanstack/react-router";
import { getApiDocsUrl } from "@/platform/config/app-config";
import { buildPageHead } from "@/platform/seo";

export const Route = createFileRoute("/_public/api-reference")({
  loader: () => {
    const apiDocsUrl = getApiDocsUrl(import.meta.env);
    if (!apiDocsUrl) {
      throw new Error(
        "ATLAS_API_DOCS_URL is not set. Configure it to the API-origin Scalar docs route for this environment.",
      );
    }
    throw redirect({ href: apiDocsUrl, statusCode: 308 });
  },
  head: () =>
    buildPageHead({
      title: "API Reference | Atlas",
      description: "Explore the generated Atlas REST API reference.",
      path: "/api-reference",
    }),
});
