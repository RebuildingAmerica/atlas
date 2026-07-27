// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnnotationResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas";
import {
  useCreateOrgAnnotation,
  useOrgAnnotations,
} from "@/domains/catalog/hooks/use-org-annotations";
import { createTestQueryClient } from "../../../../helpers/render-with-providers";
import { stubFetch } from "../../../../helpers/stub-fetch";
import type { StubbedFetch, StubbedResponse } from "../../../../helpers/stub-fetch";

describe("private workspace annotation hooks", () => {
  interface ProvidersProps {
    children: ReactNode;
  }

  let queryClient: QueryClient;
  let http: StubbedFetch;
  let routes: Map<string, StubbedResponse>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    routes = new Map<string, StubbedResponse>();
    http = stubFetch((input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const target = `${init?.method ?? "GET"} ${url.pathname}${url.search}`;
      return routes.get(target) ?? { body: { detail: `unrouted ${target}` }, status: 404 };
    });
  });

  function Providers({ children }: ProvidersProps) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  function requestedTargets(): string[] {
    return http.requests.map((request) => {
      const url = new URL(request.url);
      return `${request.init?.method ?? "GET"} ${url.pathname}${url.search}`;
    });
  }

  function note(overrides: Partial<AnnotationResponse> = {}): AnnotationResponse {
    return {
      author_id: "user_1",
      content: "Called their comms lead, waiting on a callback.",
      created_at: "2026-01-01T00:00:00Z",
      id: "annotation_1",
      org_id: "org_1",
      target_id: "entry_1",
      target_type: "entry",
      updated_at: "2026-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("loads the notes an entry carries for the active workspace", async () => {
    routes.set("GET /api/orgs/org_1/annotations?entry_id=entry_1", { body: [note()] });

    const { result } = renderHook(() => useOrgAnnotations("org_1", { entryId: "entry_1" }), {
      wrapper: Providers,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual([note()]);
  });

  it("filters by source when the note is attached to a source packet", async () => {
    routes.set("GET /api/orgs/org_1/annotations?source_id=source_1", {
      body: [note({ source_id: "source_1", target_id: "source_1", target_type: "source" })],
    });

    const { result } = renderHook(() => useOrgAnnotations("org_1", { sourceId: "source_1" }), {
      wrapper: Providers,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.[0]?.target_type).toBe("source");
  });

  it("asks for every note in the workspace when no target is named", async () => {
    routes.set("GET /api/orgs/org_1/annotations", { body: [] });

    const { result } = renderHook(() => useOrgAnnotations("org_1", {}), { wrapper: Providers });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(requestedTargets()).toEqual(["GET /api/orgs/org_1/annotations"]);
  });

  it("keys each target separately so one entry's notes never show on another", async () => {
    routes.set("GET /api/orgs/org_1/annotations?entry_id=entry_1", { body: [note()] });

    const { result } = renderHook(() => useOrgAnnotations("org_1", { entryId: "entry_1" }), {
      wrapper: Providers,
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryClient.getQueryData(["org-annotations", "org_1", "entry_1", null])).toEqual([
      note(),
    ]);
    expect(queryClient.getQueryData(["org-annotations", "org_1", "entry_2", null])).toBeUndefined();
  });

  it("stays idle for a visitor with no workspace selected", () => {
    const { result } = renderHook(() => useOrgAnnotations(null, { entryId: "entry_1" }), {
      wrapper: Providers,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(http.requests).toHaveLength(0);
  });

  it("stays idle while the notes panel is closed", () => {
    const { result } = renderHook(() => useOrgAnnotations("org_1", { entryId: "entry_1" }, false), {
      wrapper: Providers,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(http.requests).toHaveLength(0);
  });

  it("fails loudly instead of showing an empty notes panel when no workspace is active", async () => {
    const { result } = renderHook(() => useOrgAnnotations(undefined, { entryId: "entry_1" }), {
      wrapper: Providers,
    });

    const refetched = await result.current.refetch();

    expect(refetched.error?.message).toBe("Organization ID is required to load private notes.");
    expect(refetched.data).toBeUndefined();
    expect(http.requests).toHaveLength(0);
  });

  it("writes a note and refreshes every annotation view in the workspace", async () => {
    routes.set("GET /api/orgs/org_1/annotations?entry_id=entry_1", { body: [] });
    routes.set("POST /api/orgs/org_1/annotations", { body: note() });

    const { result } = renderHook(
      () => ({
        create: useCreateOrgAnnotation(),
        notes: useOrgAnnotations("org_1", { entryId: "entry_1" }),
      }),
      { wrapper: Providers },
    );
    await waitFor(() => {
      expect(result.current.notes.isSuccess).toBe(true);
    });

    routes.set("GET /api/orgs/org_1/annotations?entry_id=entry_1", { body: [note()] });
    const created = await result.current.create.mutateAsync({
      body: { content: "Called their comms lead, waiting on a callback.", entry_id: "entry_1" },
      orgId: "org_1",
    });

    expect(created).toEqual(note());
    expect(requestedTargets()).toContain("POST /api/orgs/org_1/annotations");
    await waitFor(() => {
      expect(result.current.notes.data).toEqual([note()]);
    });
  });
});
