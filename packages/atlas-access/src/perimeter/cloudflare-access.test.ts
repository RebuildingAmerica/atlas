// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  certsFetch,
  encodeSegment,
  makeAccessTestKeys,
  signAccessToken,
  TEST_AUDIENCE,
  TEST_OPERATOR,
  TEST_TEAM_DOMAIN,
} from "./access-test-keys";
import {
  CloudflareAccessVerifier,
  parseAccessConfig,
} from "./cloudflare-access";

const CONFIG = { audience: TEST_AUDIENCE, teamDomain: TEST_TEAM_DOMAIN };

function requestWith(token?: string, cookieToken?: string): Request {
  const headers = new Headers();
  if (token !== undefined) headers.set("Cf-Access-Jwt-Assertion", token);
  if (cookieToken !== undefined)
    headers.set("Cookie", `CF_Authorization=${cookieToken}`);
  return new Request("https://atlas-admin.rebuildingus.org/", { headers });
}

describe("parseAccessConfig", () => {
  it("accepts a team domain and a 64-character hex audience", () => {
    expect(
      parseAccessConfig({
        ATLAS_ACCESS_AUD: TEST_AUDIENCE,
        ATLAS_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
      }),
    ).toEqual(CONFIG);
  });

  it("normalizes a team domain written as a URL or in capitals", () => {
    expect(
      parseAccessConfig({
        ATLAS_ACCESS_AUD: TEST_AUDIENCE,
        ATLAS_ACCESS_TEAM_DOMAIN: `https://${TEST_TEAM_DOMAIN.toUpperCase()}/`,
      }).teamDomain,
    ).toBe(TEST_TEAM_DOMAIN);
  });

  it.each([
    [{}, "ATLAS_ACCESS_TEAM_DOMAIN is required."],
    [
      { ATLAS_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN },
      "ATLAS_ACCESS_AUD is required.",
    ],
    [
      {
        ATLAS_ACCESS_AUD: TEST_AUDIENCE,
        ATLAS_ACCESS_TEAM_DOMAIN: "atlas-test",
      },
      "ATLAS_ACCESS_TEAM_DOMAIN must be a <team>.cloudflareaccess.com host.",
    ],
    [
      {
        ATLAS_ACCESS_AUD: "not-hex",
        ATLAS_ACCESS_TEAM_DOMAIN: TEST_TEAM_DOMAIN,
      },
      "ATLAS_ACCESS_AUD must be the 64-character application audience tag.",
    ],
  ])("refuses incomplete or malformed config %#", (env, message) => {
    expect(() => parseAccessConfig(env)).toThrow(message);
  });
});

describe("CloudflareAccessVerifier", () => {
  it("names the operator Access signed in", async () => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certsFetch([keys]).fetch,
    });

    const result = await verifier.verify(
      requestWith(await signAccessToken(keys)),
    );

    expect(result).toEqual({
      ok: true,
      principal: {
        email: TEST_OPERATOR,
        issuer: `https://${TEST_TEAM_DOMAIN}`,
        plane: "staff",
        subject: "operator-subject",
      },
    });
  });

  it("accepts an audience written as a single string and lowercases the email", async () => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certsFetch([keys]).fetch,
    });

    const result = await verifier.verify(
      requestWith(
        await signAccessToken(keys, {
          aud: TEST_AUDIENCE,
          email: "Willie@RebuildingUS.org",
        }),
      ),
    );

    expect(result.ok && result.principal.email).toBe("willie@rebuildingus.org");
  });

  it("refuses a request with no assertion, even with an Access cookie", async () => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certsFetch([keys]).fetch,
    });

    const result = await verifier.verify(
      requestWith(undefined, await signAccessToken(keys)),
    );

    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it.each([
    ["wrong_audience", { aud: ["someone-elses-app"] }],
    ["wrong_issuer", { iss: "https://evil.cloudflareaccess.com" }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 10 }],
    ["expired", { exp: undefined }],
    ["not_yet_valid", { nbf: Math.floor(Date.now() / 1000) + 600 }],
    ["not_yet_valid", { nbf: "soon" }],
    ["no_email", { email: undefined }],
    ["no_email", { email: "not-an-address" }],
    ["service_token", { common_name: "client-id.access", email: undefined }],
  ])("refuses a token whose claims are %s", async (reason, claims) => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certsFetch([keys]).fetch,
    });

    const result = await verifier.verify(
      requestWith(await signAccessToken(keys, claims)),
    );

    expect(result).toEqual({ ok: false, reason });
  });

  it("allows a not-before stamp within a minute of clock skew", async () => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certsFetch([keys]).fetch,
    });

    const result = await verifier.verify(
      requestWith(
        await signAccessToken(keys, {
          nbf: Math.floor(Date.now() / 1000) + 30,
        }),
      ),
    );

    expect(result.ok).toBe(true);
  });

  it.each([
    ["none", { alg: "none" }],
    ["HS256", { alg: "HS256" }],
    ["no key id", { kid: undefined }],
  ])("refuses a token signed with %s", async (_label, header) => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certsFetch([keys]).fetch,
    });

    const result = await verifier.verify(
      requestWith(await signAccessToken(keys, {}, header)),
    );

    expect(result).toEqual({ ok: false, reason: "wrong_algorithm" });
  });

  it("refuses a token signed by a key Access never published", async () => {
    const published = await makeAccessTestKeys("published");
    const forger = await makeAccessTestKeys("published");
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certsFetch([published]).fetch,
    });

    const result = await verifier.verify(
      requestWith(await signAccessToken(forger)),
    );

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a token whose claims were changed after signing", async () => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certsFetch([keys]).fetch,
    });
    const [head, , signature] = (await signAccessToken(keys)).split(".");
    const forged = encodeSegment({
      aud: [TEST_AUDIENCE],
      email: "attacker@example.org",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: `https://${TEST_TEAM_DOMAIN}`,
    });

    const result = await verifier.verify(
      requestWith(`${head}.${forged}.${signature}`),
    );

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it.each([["garbage"], ["a.b"], ["a.b.c.d"], ["!!!.###.$$$"]])(
    "refuses a malformed token %s",
    async (token) => {
      const keys = await makeAccessTestKeys();
      const verifier = new CloudflareAccessVerifier(CONFIG, {
        fetch: certsFetch([keys]).fetch,
      });

      const result = await verifier.verify(requestWith(token));

      expect(result).toEqual({ ok: false, reason: "malformed" });
    },
  );

  it("refuses a token whose claims are not an object", async () => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certsFetch([keys]).fetch,
    });
    const head = encodeSegment({ alg: "RS256", kid: keys.kid });

    const result = await verifier.verify(
      requestWith(`${head}.${encodeSegment([1, 2])}.sig`),
    );

    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("fetches the team's keys once and reuses them", async () => {
    const keys = await makeAccessTestKeys();
    const certs = certsFetch([keys]);
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certs.fetch,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await verifier.verify(requestWith(await signAccessToken(keys)));
    }

    expect(certs.calls).toEqual([
      `https://${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`,
    ]);
  });

  it("refetches at most once a minute when a token names an unknown key", async () => {
    const keys = await makeAccessTestKeys("current");
    const stranger = await makeAccessTestKeys("unknown");
    const certs = certsFetch([keys]);
    let now = Date.now();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certs.fetch,
      now: () => now,
    });

    await verifier.verify(requestWith(await signAccessToken(keys)));
    const first = await verifier.verify(
      requestWith(await signAccessToken(stranger)),
    );
    await verifier.verify(requestWith(await signAccessToken(stranger)));
    now += 61_000;
    await verifier.verify(requestWith(await signAccessToken(stranger)));

    expect(first).toEqual({ ok: false, reason: "unknown_key" });
    expect(certs.calls).toHaveLength(2);
  });

  it("picks up a rotated key after the key cache expires", async () => {
    const before = await makeAccessTestKeys("before");
    const after = await makeAccessTestKeys("after");
    const certs = certsFetch([before], [before, after]);
    let now = Date.now();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certs.fetch,
      now: () => now,
    });

    await verifier.verify(requestWith(await signAccessToken(before)));
    now += 3_601_000;
    const result = await verifier.verify(
      requestWith(
        await signAccessToken(after, { exp: Math.floor(now / 1000) + 600 }),
      ),
    );

    expect(result.ok).toBe(true);
  });

  it("refuses rather than throws when the certs endpoint fails", async () => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: () => Promise.resolve(new Response("down", { status: 503 })),
    });

    const result = await verifier.verify(
      requestWith(await signAccessToken(keys)),
    );

    expect(result).toEqual({ ok: false, reason: "key_fetch_failed" });
  });

  it("ignores published keys it cannot use", async () => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: () =>
        Promise.resolve(
          Response.json({
            keys: [
              { kty: "EC", kid: keys.kid },
              { ...keys.publicJwk, kid: undefined },
            ],
          }),
        ),
    });

    const result = await verifier.verify(
      requestWith(await signAccessToken(keys)),
    );

    expect(result).toEqual({ ok: false, reason: "unknown_key" });
  });

  it("treats a team that publishes no keys as an unknown key", async () => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certsFetch().fetch,
    });

    const result = await verifier.verify(
      requestWith(await signAccessToken(keys)),
    );

    expect(result).toEqual({ ok: false, reason: "unknown_key" });
  });

  it("records an empty subject when Access sends none", async () => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: certsFetch([keys]).fetch,
    });

    const result = await verifier.verify(
      requestWith(await signAccessToken(keys, { sub: undefined })),
    );

    expect(result.ok && result.principal.subject).toBe("");
  });

  it("uses the platform fetch and clock by default", async () => {
    const keys = await makeAccessTestKeys();
    const certs = certsFetch([keys]);
    vi.stubGlobal("fetch", certs.fetch);
    try {
      const verifier = new CloudflareAccessVerifier(CONFIG);

      const result = await verifier.verify(
        requestWith(await signAccessToken(keys)),
      );

      expect(result.ok).toBe(true);
      expect(certs.calls).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("treats a certs response without a key list as no keys", async () => {
    const keys = await makeAccessTestKeys();
    const verifier = new CloudflareAccessVerifier(CONFIG, {
      fetch: () => Promise.resolve(Response.json({})),
    });

    const result = await verifier.verify(
      requestWith(await signAccessToken(keys)),
    );

    expect(result).toEqual({ ok: false, reason: "unknown_key" });
  });
});
