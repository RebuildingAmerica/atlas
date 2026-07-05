import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { createFileRoute } from "@tanstack/react-router";
import { buildPageHead } from "@/platform/seo";

const OPENAPI_DOCUMENT_URL = "/openapi.json";

type ScalarConfiguration = Parameters<typeof ApiReferenceReact>[0]["configuration"];

const SCALAR_CONFIGURATION: ScalarConfiguration = {
  url: OPENAPI_DOCUMENT_URL,
  title: "Atlas REST API",
  layout: "modern",
  theme: "default",
  showSidebar: true,
  showDeveloperTools: "always",
  operationTitleSource: "summary",
  hideModels: false,
  modelsSectionLabel: "Schemas",
  documentDownloadType: "both",
  hideTestRequestButton: false,
  hideSearch: false,
  showOperationId: true,
  hideDarkModeToggle: false,
  persistAuth: true,
  telemetry: false,
  defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
  defaultOpenFirstTag: true,
  defaultOpenAllTags: false,
  expandAllModelSections: false,
  expandAllResponses: false,
  expandAllSchemaProperties: false,
  orderSchemaPropertiesBy: "preserve",
  orderRequiredPropertiesFirst: true,
  withDefaultFonts: true,
  searchHotKey: "k",
  customCss: `
body { margin: 0; }
.light-mode,
.dark-mode {
  --scalar-color-accent: #a67b50;
  --scalar-color-accent-hover: #8d6640;
}
`.trim(),
};

export const Route = createFileRoute("/_public/api-reference")({
  ssr: false,
  head: () =>
    buildPageHead({
      title: "API Reference | Atlas",
      description: "Explore the generated Atlas REST API reference.",
      path: "/api-reference",
    }),
  component: ApiReferencePage,
});

function ApiReferencePage() {
  return (
    <div className="min-h-screen bg-white">
      <ApiReferenceReact configuration={SCALAR_CONFIGURATION} />
    </div>
  );
}
