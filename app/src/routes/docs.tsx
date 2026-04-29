import { createFileRoute, redirect } from "@tanstack/react-router";
import { getDocsUrl } from "@/platform/config/app-config";

export const Route = createFileRoute("/docs")({
  loader: ({ location }) => {
    // Only redirect the bare /docs path. Deeper paths like /docs/mcp are
    // handled by routes/docs.$.tsx; returning early lets the child loader run.
    const pathname = location.pathname.replace(/\/+$/, "");
    if (pathname !== "/docs") {
      return;
    }
    const docsUrl = getDocsUrl(import.meta.env);
    if (!docsUrl) {
      throw new Error(
        "ATLAS_DOCS_URL is not set. In dev, set it to the local docs origin (e.g. https://docs.localhost:1355).",
      );
    }
    throw redirect({ href: docsUrl, statusCode: 308 });
  },
});
