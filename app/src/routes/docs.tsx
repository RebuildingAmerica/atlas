import { createFileRoute, redirect } from "@tanstack/react-router";
import { PageLayout } from "@/platform/layout/page-layout";
import { getDocsUrl } from "@/platform/config/app-config";

export const Route = createFileRoute("/docs")({
  loader: () => {
    const docsUrl = getDocsUrl(import.meta.env);
    if (docsUrl) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({
        href: docsUrl,
        statusCode: 308,
      });
    }

    return {};
  },
  component: DocsUnavailablePage,
});

function DocsUnavailablePage() {
  return (
    <PageLayout className="py-20">
      <div className="border-border mx-auto max-w-2xl rounded-[1.8rem] border bg-white/80 p-8 text-center shadow-sm">
        <p className="type-label-medium text-ink-muted">Atlas Docs</p>
        <h1 className="type-headline-medium text-ink-strong mt-4">Docs URL is not configured</h1>
        <p className="type-body-large text-ink-soft mt-4">
          Set <code>ATLAS_DOCS_URL</code> on the app deployment to send <code>/docs</code> to the
          Mintlify site.
        </p>
      </div>
    </PageLayout>
  );
}
