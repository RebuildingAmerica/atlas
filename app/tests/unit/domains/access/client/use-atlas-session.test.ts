import { describe, expect, it, vi } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { getAuthConfig } from "@/domains/access/config";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { getAtlasSession } from "@/domains/access/session.functions";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

vi.mock("@/domains/access/config", () => ({
  getAuthConfig: vi.fn(),
}));

describe("useAtlasSession", () => {
  it("configures the session query for local mode", () => {
    vi.mocked(getAuthConfig).mockReturnValue({ authBasePath: "/api/auth", localMode: true });
    vi.mocked(useQuery).mockReturnValue({ kind: "query-result" } as unknown as ReturnType<
      typeof useQuery
    >);

    const result = useAtlasSession();

    expect(result).toEqual({ kind: "query-result" });
    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryFn: getAtlasSession,
        queryKey: ["auth", "session", true],
        staleTime: Infinity,
      }),
    );
  });

  it("configures the session query for auth-enabled mode", () => {
    vi.mocked(getAuthConfig).mockReturnValue({ authBasePath: "/api/auth", localMode: false });
    vi.mocked(useQuery).mockReturnValue({ kind: "query-result" } as unknown as ReturnType<
      typeof useQuery
    >);

    useAtlasSession();

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["auth", "session", false],
        staleTime: 30_000,
      }),
    );
  });
});
