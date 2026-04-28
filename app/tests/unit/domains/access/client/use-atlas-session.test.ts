import { describe, expect, it, vi } from "vitest";
import { useQuery } from "@tanstack/react-query";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { getAtlasSession } from "@/domains/access/session.functions";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

describe("useAtlasSession", () => {
  it("configures the session query against the Atlas server function", () => {
    vi.mocked(useQuery).mockReturnValue({ kind: "query-result" } as unknown as ReturnType<
      typeof useQuery
    >);

    const result = useAtlasSession();

    expect(result).toEqual({ kind: "query-result" });
    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryFn: getAtlasSession,
        queryKey: ["auth", "session"],
        staleTime: 30_000,
      }),
    );
  });
});
