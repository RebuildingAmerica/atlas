import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { createTestQueryClient } from "./render-with-providers";

/** Renders the public report status route with a fresh query client. */
export async function renderReportStatusPage(): Promise<void> {
  const { Route } = await import("@/routes/_public/reports/$reportId");
  const Component = Route.options.component as ComponentType;
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <Component />
    </QueryClientProvider>,
  );
}
