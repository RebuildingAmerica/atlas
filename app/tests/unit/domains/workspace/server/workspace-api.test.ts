import { beforeEach, describe, expect, it, vi } from "vitest";

describe("workspace API server helpers", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses to reach the workspace runtime if it is ever bundled into the browser", async () => {
    // import.meta.env.SSR is false in a client bundle; the guard exists so a
    // bad import graph fails loudly instead of shipping workspace credentials
    // to a page.
    vi.stubEnv("SSR", "" as never);

    const { requestWorkspaceApi, requireActiveWorkspaceId } =
      await import("@/domains/workspace/server/workspace-api");

    await expect(requestWorkspaceApi("/orgs/org_123/briefs")).rejects.toThrow(
      "Workspace API server helpers are only available on the server.",
    );
    await expect(requireActiveWorkspaceId("Open a workspace first.")).rejects.toThrow(
      "Workspace API server helpers are only available on the server.",
    );
  });
});
