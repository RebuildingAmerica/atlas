// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  WORKSPACE_PAGE_TITLES,
  type StaticRouteHead,
} from "../../../fixtures/routes/workspace-page-titles";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("workspace page titles", () => {
  it.each(WORKSPACE_PAGE_TITLES)("titles the %s page", async (_name, load, title) => {
    const { Route } = await load();
    const head = Route.options.head as (context: object) => StaticRouteHead;
    expect(head({}).meta[0]?.title).toBe(title);
  });
});
