import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestAtlasApi: vi.fn(),
  requireReadyAtlasSessionState: vi.fn(),
}));

vi.mock("@/domains/access/server/session-state", () => ({
  requireReadyAtlasSessionState: mocks.requireReadyAtlasSessionState,
}));

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("workspace Firehose server helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
  });

  it("loads a workspace-owned Firehose snapshot through the top-level query surface", async () => {
    const snapshot = {
      cursor: null,
      generated_at: "2026-07-06T12:00:00Z",
      links: {
        events: "/api/firehose",
        next: "/api/firehose?cursor=",
        self: "/api/firehose",
      },
      query: {
        actor_types: [],
        cursor: null,
        issues: ["housing"],
        limit: 50,
        places: ["las-vegas-nv"],
        signal_types: ["public_meeting"],
        since: null,
        sort: "detected_at_desc",
        source_classes: [],
        until: null,
        visibility: "workspace",
      },
      session: null,
      signals: [],
      summary: {
        held_signals: 0,
        latest_cursor: null,
        total_signals: 0,
        visible_signals: 0,
      },
      usage: {
        meter: "firehose_snapshot",
        query_fingerprint: "0".repeat(64),
      },
      workspace: {
        actor_id: "user_123",
        api_key_id: null,
        auth_type: "internal",
        org_id: "org_123",
      },
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(snapshot);

    const { loadWorkspaceFirehoseSnapshotData } =
      await import("@/domains/workspace/server/firehose");
    const result = await loadWorkspaceFirehoseSnapshotData({
      issues: ["housing"],
      places: ["las-vegas-nv"],
      signalTypes: ["public_meeting"],
    });

    expect(result).toBe(snapshot);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/firehose?place=las-vegas-nv&issue=housing&signal_type=public_meeting",
      {
        headers: {
          Accept: "application/json",
        },
      },
    );
  });

  it("builds the SSE URL for the same workspace Firehose query", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });

    const { buildWorkspaceFirehoseEventsUrlData } =
      await import("@/domains/workspace/server/firehose");
    const result = await buildWorkspaceFirehoseEventsUrlData({
      issues: ["housing", "transit"],
      places: ["las-vegas-nv"],
    });

    expect(result).toBe("/api/firehose?place=las-vegas-nv&issue=housing&issue=transit");
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("fails before fetching when there is no active workspace", async () => {
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: null,
      },
    });

    const { loadWorkspaceFirehoseSnapshotData } =
      await import("@/domains/workspace/server/firehose");

    await expect(loadWorkspaceFirehoseSnapshotData()).rejects.toThrow(
      "Open a workspace before loading Firehose.",
    );
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });
});
