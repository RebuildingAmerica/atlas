import { afterEach, expect, it, vi } from "vitest";
import {
  atlasFetch,
  fetchAtlasApiResponse,
  setServerApiTransportProvider,
} from "./fetcher";

afterEach(() => {
  setServerApiTransportProvider(undefined);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("uses the current server transport separately for each call", async () => {
  vi.stubGlobal("window", undefined);
  vi.stubEnv("ATLAS_SERVER_API_PROXY_TARGET", "https://api.example.com");
  let visitor = "first";
  setServerApiTransportProvider(() => {
    const current = visitor;
    return (request) =>
      Promise.resolve(Response.json({ visitor: current, url: request.url }));
  });
  expect(await atlasFetch("/api/entities?q=one")).toEqual({
    visitor: "first",
    url: "https://api.example.com/api/entities?q=one",
  });
  visitor = "second";
  expect(await atlasFetch("/api/entities")).toEqual({
    visitor: "second",
    url: "https://api.example.com/api/entities",
  });
});

it("keeps browser requests off the registered server provider", async () => {
  vi.stubGlobal("window", { location: { origin: "https://web.example.com" } });
  const provider = vi.fn(() => {
    throw new Error("server provider invoked in browser");
  });
  setServerApiTransportProvider(provider);
  const network = vi.fn(() =>
    Promise.resolve(Response.json({ browser: true })),
  );
  vi.stubGlobal("fetch", network);
  expect(await atlasFetch("/api/entities")).toEqual({ browser: true });
  expect(provider).not.toHaveBeenCalled();
  expect(network).toHaveBeenCalledWith(
    "https://web.example.com/api/entities",
    expect.anything(),
  );
});

it("preserves network fetch without a binding or when the scoped transport declines the URL", async () => {
  vi.stubGlobal("window", undefined);
  const network = vi.fn(() =>
    Promise.resolve(new Response("network", { status: 202 })),
  );
  vi.stubGlobal("fetch", network);
  for (const provider of [
    undefined,
    () => undefined,
    () => () => Promise.resolve(undefined),
  ]) {
    setServerApiTransportProvider(provider);
    const response = await fetchAtlasApiResponse(
      "https://other.example.com/data",
      { method: "POST", body: "hello" },
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("network");
  }
  expect(network).toHaveBeenCalledTimes(3);
});
