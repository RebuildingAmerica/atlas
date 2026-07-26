import { vi } from "vitest";

/** One canned HTTP reply. */
export interface StubbedResponse {
  body?: unknown;
  headers?: Record<string, string>;
  status?: number;
}

/** Decides what a given request should get back. */
export type FetchResponder = (input: RequestInfo | URL, init?: RequestInit) => StubbedResponse;

export interface StubbedFetch {
  /** The installed mock, for `toHaveBeenCalledWith` style assertions. */
  mock: ReturnType<typeof vi.fn>;
  /** Every request the subject made, in order. */
  requests: { init?: RequestInit; url: string }[];
}

/**
 * Builds a `Response` without depending on jsdom's, which is absent in the
 * node-environment suites.
 *
 * @param reply - Status, headers and JSON body to serve.
 * @returns A Response-shaped object with the methods callers actually use.
 */
function toResponse(reply: StubbedResponse): Response {
  const status = reply.status ?? 200;
  const body = reply.body === undefined ? "" : JSON.stringify(reply.body);
  return {
    headers: new Headers(reply.headers ?? { "content-type": "application/json" }),
    json: () => Promise.resolve(reply.body),
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Renders any fetch input as the URL string a test would assert on.
 *
 * @param input - Whatever the subject passed to `fetch`.
 * @returns The request URL.
 */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Installs a `fetch` stub for the current test.
 *
 * Twenty-odd suites hand-rolled this, each with its own idea of what a Response
 * looks like, so a test asserting on `response.ok` in one file and `.json()` in
 * another needed different stubs. `unstubGlobals` in the vitest config unwinds
 * the global afterwards, so there is nothing to clean up.
 *
 * @param responder - A single reply for every request, or a function choosing
 *   per request.
 * @returns The mock and a recorded request log.
 */
export function stubFetch(responder: FetchResponder | StubbedResponse): StubbedFetch {
  const requests: { init?: RequestInit; url: string }[] = [];
  const decide: FetchResponder = typeof responder === "function" ? responder : () => responder;

  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ init, url: requestUrl(input) });
    return Promise.resolve(toResponse(decide(input, init)));
  });

  vi.stubGlobal("fetch", mock);
  return { mock, requests };
}
