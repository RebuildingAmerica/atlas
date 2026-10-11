import { vi } from "vitest";
import type { AdminRuntime, AdminRuntimeResult } from "@/server/admin-runtime";
import { makeRuntime, makeSigningKey, signedInRequest } from "./admin-fixtures";

/** What a platform-fetch test feeds the mocked request and runtime modules. */
export interface PlatformFetchState {
  request: Request;
  runtime: AdminRuntimeResult | undefined;
}

/** Answers every fetch with `response` and returns the mock to inspect calls. */
export function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Points the state at a configured runtime and a request Access signed in. */
export async function signInOperator(
  state: PlatformFetchState,
): Promise<AdminRuntime> {
  const { pkcs8 } = await makeSigningKey();
  const { keys, runtime } = await makeRuntime({}, pkcs8);
  // These response-mapping tests use the explicit local HTTP transport.
  state.runtime = { ...runtime, development: true };
  state.request = await signedInRequest(keys);
  return state.runtime;
}
