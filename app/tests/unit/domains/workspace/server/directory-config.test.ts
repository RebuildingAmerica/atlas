import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryConfigRequest } from "@rebuildingamerica/atlas-api-client/generated/atlas";
import type { ServerFnExecutionResponse } from "../../../../helpers/server-fn-stub";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  requireReadyAtlasSessionState: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/access/server/session-state", () => ({
  requireReadyAtlasSessionState: mocks.requireReadyAtlasSessionState,
}));

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("workspace directory config server helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
  });

  it("loads directory config for the active workspace", async () => {
    const config = {
      org_id: "org_123",
      title: "Detroit tenant power directory",
      sponsor_label: "Supported by Detroit Housing Fund",
      scope: {
        issue_area_ids: ["housing_affordability"],
        geography_labels: ["Detroit, MI"],
        entry_types: ["organization"],
      },
      methodology: {
        summary: "Reviewed records with linked public sources.",
        source_policy: "Every listing includes a public source.",
        review_policy: "Records are checked before publication.",
        correction_policy: "Readers can send corrections.",
        correction_path_template: "/feedback/{slug}?kind=incorrect",
        missing_context_path_template: "/feedback/{slug}?kind=missing_context",
      },
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: { id: "org_123" },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(config);

    const { loadWorkspaceDirectoryConfigData } =
      await import("@/domains/workspace/server/directory-config");
    const result = await loadWorkspaceDirectoryConfigData();

    expect(result).toBe(config);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/entries/directory-config");
  });

  it("saves directory config for the active workspace", async () => {
    const input: DirectoryConfigRequest = {
      title: "Detroit tenant power directory",
      sponsor_label: "Supported by Detroit Housing Fund",
      scope: {
        issue_area_ids: ["housing_affordability"],
        geography_labels: ["Detroit, MI"],
        entry_types: ["organization"],
      },
      methodology: {
        summary: "Reviewed records with linked public sources.",
        source_policy: "Every listing includes a public source.",
        review_policy: "Records are checked before publication.",
        correction_policy: "Readers can send corrections.",
        correction_path_template: "/feedback/{slug}?kind=incorrect",
        missing_context_path_template: "/feedback/{slug}?kind=missing_context",
      },
    };
    const updated = { org_id: "org_123", ...input };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: { id: "org_123" },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(updated);

    const { updateWorkspaceDirectoryConfigData } =
      await import("@/domains/workspace/server/directory-config");
    const result = await updateWorkspaceDirectoryConfigData(input);

    expect(result).toBe(updated);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/entries/directory-config", {
      body: JSON.stringify(input),
      method: "PUT",
    });
  });

  it("fails before fetching when there is no active workspace", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: null,
      },
    });

    const { loadWorkspaceDirectoryConfigData } =
      await import("@/domains/workspace/server/directory-config");

    await expect(loadWorkspaceDirectoryConfigData()).rejects.toThrow(
      "Open a workspace before editing public directory settings.",
    );
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});

describe("workspace directory config server functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: { activeOrganization: { id: "org_123" } },
    });
  });

  it("returns the public directory configuration through the GET server function", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ org_id: "org_123", title: "Detroit tenant power" });

    const { loadWorkspaceDirectoryConfig } =
      await import("@/domains/workspace/server/directory-config");
    const response = (await loadWorkspaceDirectoryConfig.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ org_id: "org_123", title: "Detroit tenant power" });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/entries/directory-config");
  });

  it("saves the directory title an operator typed", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ org_id: "org_123", title: "Detroit tenant power" });

    const { updateWorkspaceDirectoryConfig } =
      await import("@/domains/workspace/server/directory-config");
    const response = (await updateWorkspaceDirectoryConfig.__executeServer({
      data: { title: "  Detroit tenant power  " },
      method: "POST",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/orgs/org_123/entries/directory-config", {
      body: JSON.stringify({ title: "Detroit tenant power" }),
      method: "PUT",
    });
  });

  it("rejects a directory title that is only whitespace", async () => {
    const { updateWorkspaceDirectoryConfig } =
      await import("@/domains/workspace/server/directory-config");
    const response = (await updateWorkspaceDirectoryConfig.__executeServer({
      data: { title: "   " },
      method: "POST",
    })) as ServerFnExecutionResponse;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});
