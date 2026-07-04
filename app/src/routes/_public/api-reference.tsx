import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { createFileRoute } from "@tanstack/react-router";

const OPENAPI_DOCUMENT_URL = "/openapi.json";

export const Route = createFileRoute("/_public/api-reference")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "API Reference | Atlas" },
      {
        name: "description",
        content: "Explore the generated Atlas REST API reference.",
      },
    ],
  }),
  component: ApiReferencePage,
});

function ApiReferencePage() {
  return (
    <div className="min-h-screen bg-white">
      <ApiReferenceReact configuration={{ url: OPENAPI_DOCUMENT_URL }} />
    </div>
  );
}
