import { createFileRoute, redirect } from "@tanstack/react-router";
import { getDocsUrl } from "@/platform/config/app-config";

/**
 * Catch-all redirect for `/docs/<path>` so that documentation deep links
 * (and the `resource_documentation` URL the OAuth protected-resource
 * metadata advertises at `${publicBaseUrl}/docs/mcp`) resolve to the
 * configured docs origin instead of returning the SPA fallback.
 *
 * The bare `/docs` redirect lives in `routes/docs.tsx`; this file handles
 * every nested path under it.
 */
export const Route = createFileRoute("/docs/$")({
  loader: ({ params }) => {
    const docsUrl = getDocsUrl(import.meta.env);
    if (!docsUrl) {
      throw new Error(
        "ATLAS_DOCS_URL is not set. In dev, set it to the local docs origin (e.g. https://docs.localhost:1355).",
      );
    }
    const trimmed = docsUrl.replace(/\/+$/, "");
    const subpath = params._splat ?? "";
    throw redirect({
      href: subpath ? `${trimmed}/${subpath}` : trimmed,
      statusCode: 308,
    });
  },
});
