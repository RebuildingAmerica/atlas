import { describe, expect, it } from "vitest";
import { anonymousSessionResponse } from "@/domains/access/server/anonymous-session";

describe("anonymous session reads", () => {
  it("returns a private null response only for a credential-free session GET", async () => {
    const response = anonymousSessionResponse(
      new Request("https://atlas.test/api/auth/get-session?disableCookieCache=true"),
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toBeNull();
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    ["cookie", "better-auth.session_token=existing"],
    ["cookie", "__Secure-better-auth.session_token=existing"],
    ["cookie", "unrecognized=value"],
    ["cookie", ""],
    ["authorization", "Bearer existing"],
    ["authorization", ""],
  ])("leaves supplied credentials to the authentication backend: %s %s", (header, value) => {
    const headers = new Headers([[header, value]]);
    expect(
      anonymousSessionResponse(new Request("https://atlas.test/api/auth/get-session", { headers })),
    ).toBeNull();
  });

  it.each([
    ["POST", "/api/auth/get-session"],
    ["GET", "/api/auth/sign-out"],
    ["GET", "/api/auth/get-session/"],
    ["GET", "/api/auth/get-session/other"],
  ])("preserves %s %s routing", (method, path) => {
    expect(
      anonymousSessionResponse(new Request(`https://atlas.test${path}`, { method })),
    ).toBeNull();
  });
});
