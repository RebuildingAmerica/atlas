import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("lists workspace Firehose source targets for a coverage target", async () => {
    const collection = { items: [], total: 0 };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValue(collection);

    const { loadWorkspaceFirehoseSourceTargetsData } =
      await import("@/domains/workspace/server/firehose");
    const result = await loadWorkspaceFirehoseSourceTargetsData({
      coverageTargetId: "target_123",
    });

    expect(result).toBe(collection);
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/firehose/source-targets?coverage_target_id=target_123",
    );
  });

  it("creates and runs workspace Firehose source targets", async () => {
    const sourceTarget = { id: "source_target_123" };
    const runResult = {
      artifacts_created: 1,
      routes_created: 2,
      signals_created: 1,
      unchanged: false,
    };
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: {
        activeOrganization: {
          id: "org_123",
        },
      },
    });
    mocks.requestAtlasApi.mockResolvedValueOnce(sourceTarget).mockResolvedValueOnce(runResult);

    const { createWorkspaceFirehoseSourceTargetData, runWorkspaceFirehoseSourceTargetData } =
      await import("@/domains/workspace/server/firehose");
    const created = await createWorkspaceFirehoseSourceTargetData({
      coverage_target_id: "target_123",
      issues: ["transit"],
      label: "Toledo Civic Agenda",
      places: ["toledo-oh"],
      public_route_enabled: true,
      source_class: "government_agenda",
      source_kind: "rss",
      url: "https://toledo.example/feed.xml",
    });
    const result = await runWorkspaceFirehoseSourceTargetData({
      body: "<rss />",
      content_type: "application/rss+xml",
      fetched_at: "2026-07-07T16:21:00Z",
      sourceTargetId: "source_target_123",
      status_code: 200,
      url: "https://toledo.example/feed.xml",
    });

    expect(created).toBe(sourceTarget);
    expect(result).toBe(runResult);
    expect(mocks.requestAtlasApi).toHaveBeenNthCalledWith(1, "/firehose/source-targets", {
      body: JSON.stringify({
        coverage_target_id: "target_123",
        issues: ["transit"],
        label: "Toledo Civic Agenda",
        places: ["toledo-oh"],
        public_route_enabled: true,
        source_class: "government_agenda",
        source_kind: "rss",
        url: "https://toledo.example/feed.xml",
      }),
      method: "POST",
    });
    expect(mocks.requestAtlasApi).toHaveBeenNthCalledWith(
      2,
      "/firehose/source-targets/source_target_123/runs",
      {
        body: JSON.stringify({
          body: "<rss />",
          content_type: "application/rss+xml",
          fetched_at: "2026-07-07T16:21:00Z",
          status_code: 200,
          url: "https://toledo.example/feed.xml",
        }),
        method: "POST",
      },
    );
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

describe("workspace Firehose server functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: { activeOrganization: { id: "org_123" } },
    });
  });

  it("asks for the whole Firehose when the reader narrows nothing", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [] });

    const { loadWorkspaceFirehoseSnapshot } = await import("@/domains/workspace/server/firehose");
    const response = (await loadWorkspaceFirehoseSnapshot.__executeServer({
      data: {},
      method: "GET",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/firehose", {
      headers: { Accept: "application/json" },
    });
  });

  it("carries every narrowing the reader chose into the events address", async () => {
    const { buildWorkspaceFirehoseEventsUrl } = await import("@/domains/workspace/server/firehose");
    const response = (await buildWorkspaceFirehoseEventsUrl.__executeServer({
      data: {
        actorTypes: ["organization"],
        cursor: "cur_1",
        issues: ["housing"],
        limit: 25,
        places: ["las-vegas-nv"],
        signalTypes: ["public_meeting"],
        since: "2026-07-01T00:00:00Z",
        sort: "occurred_at_desc",
        sourceClasses: ["government_agenda"],
        until: "2026-07-08T00:00:00Z",
        visibility: "workspace",
      },
      method: "GET",
    })) as ServerFnExecutionResponse<string>;

    expect(response.error).toBeUndefined();
    expect(response.result).toBe(
      "/api/firehose?place=las-vegas-nv&issue=housing&actor_type=organization" +
        "&signal_type=public_meeting&source_class=government_agenda&visibility=workspace" +
        "&since=2026-07-01T00%3A00%3A00Z&until=2026-07-08T00%3A00%3A00Z&cursor=cur_1" +
        "&limit=25&sort=occurred_at_desc",
    );
  });
});

describe("workspace Firehose source-target server functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
    mocks.requireReadyAtlasSessionState.mockReset();
    mocks.requireReadyAtlasSessionState.mockResolvedValue({
      workspace: { activeOrganization: { id: "org_123" } },
    });
  });

  it("lists every workspace source target when no coverage target narrows it", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [], total: 0 });

    const { loadWorkspaceFirehoseSourceTargets } =
      await import("@/domains/workspace/server/firehose");
    const response = (await loadWorkspaceFirehoseSourceTargets.__executeServer({
      data: {},
      method: "GET",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ items: [], total: 0 });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/firehose/source-targets");
  });

  it("creates a source target from the operator's form", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ id: "source_target_1" });

    const { createWorkspaceFirehoseSourceTarget } =
      await import("@/domains/workspace/server/firehose");
    const input = {
      coverage_target_id: "coverage_1",
      issues: ["housing_affordability"],
      label: "Kansas City housing agenda",
      places: ["kansas-city-mo"],
      source_class: "government_agenda",
      source_kind: "rss",
      url: "https://example.test/kc-agenda.xml",
    };
    const response = (await createWorkspaceFirehoseSourceTarget.__executeServer({
      data: input,
      method: "POST",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({ id: "source_target_1" });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/firehose/source-targets", {
      body: JSON.stringify(input),
      method: "POST",
    });
  });

  it("rejects a source target polled by an unsupported kind", async () => {
    const { createWorkspaceFirehoseSourceTarget } =
      await import("@/domains/workspace/server/firehose");
    const response = (await createWorkspaceFirehoseSourceTarget.__executeServer({
      data: {
        coverage_target_id: "coverage_1",
        issues: ["housing_affordability"],
        label: "Kansas City housing agenda",
        places: ["kansas-city-mo"],
        source_class: "government_agenda",
        source_kind: "carrier_pigeon",
        url: "https://example.test/kc-agenda.xml",
      },
      method: "POST",
    })) as ServerFnExecutionResponse;

    expect(response.result).toBeUndefined();
    expect(response.error).toBeInstanceOf(Error);
    expect(mocks.requestAtlasApi).not.toHaveBeenCalled();
  });

  it("records a source-target poll without echoing the target id into the body", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      artifacts_created: 1,
      routes_created: 0,
      signals_created: 2,
      unchanged: false,
    });

    const { runWorkspaceFirehoseSourceTarget } =
      await import("@/domains/workspace/server/firehose");
    const response = (await runWorkspaceFirehoseSourceTarget.__executeServer({
      data: {
        body: "<rss />",
        fetched_at: "2026-07-07T16:00:00Z",
        sourceTargetId: "source target 1",
        status_code: 200,
        url: "https://example.test/kc-agenda.xml",
      },
      method: "POST",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/firehose/source-targets/source%20target%201/runs",
      {
        body: JSON.stringify({
          body: "<rss />",
          fetched_at: "2026-07-07T16:00:00Z",
          status_code: 200,
          url: "https://example.test/kc-agenda.xml",
        }),
        method: "POST",
      },
    );
  });
});
