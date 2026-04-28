import { createFileRoute, redirect } from "@tanstack/react-router";
import { PageLayout } from "@/platform/layout/page-layout";
import { getDocsUrl } from "@/platform/config/app-config";

/**
 * Catch-all redirect for `/docs/<path>` so that documentation deep links
 * (and the `resource_documentation` URL the OAuth protected-resource
 * metadata advertises at `${publicBaseUrl}/docs/mcp`) resolve to the
 * Mintlify-hosted docs site instead of returning the SPA fallback.
 *
 * The bare `/docs` redirect lives in `routes/docs.tsx`; this file handles
 * every nested path under it.
 */
export const Route = createFileRoute("/docs/$")({
  loader: ({ params }) => {
    const docsUrl = getDocsUrl(import.meta.env);
    if (!docsUrl) {
      return {};
    }

    const trimmed = docsUrl.replace(/\/+$/, "");
    const subpath = params._splat ?? "";
    throw redirect({
      href: subpath ? `${trimmed}/${subpath}` : trimmed,
      statusCode: 308,
    });
  },
  component: DocsUnavailablePage,
});

function DocsUnavailablePage() {
  return (
    <PageLayout className="py-20">
      <div className="border-outline-variant mx-auto max-w-2xl rounded-[1.8rem] border bg-white/80 p-8 text-center shadow-sm">
        <p className="type-label-medium text-outline">Atlas Docs</p>
        <h1 className="type-headline-medium text-on-surface mt-4">Documentation unavailable</h1>
        <p className="type-body-large text-outline mt-4">
          The documentation site could not be reached. Try again later.
        </p>
      </div>
    </PageLayout>
  );
}
