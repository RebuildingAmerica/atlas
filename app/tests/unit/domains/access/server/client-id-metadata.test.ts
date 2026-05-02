import { describe, expect, it } from "vitest";
import {
  ClientIdMetadataError,
  DEFAULT_CIMD_RESOLVER_OPTIONS,
  isClientIdMetadataDocumentUrl,
  resolveClientIdMetadataDocument,
  validateClientIdMetadataDocument,
} from "@/domains/access/server/client-id-metadata";
import {
  VALID_CLIENT_ID_METADATA_DOCUMENT as VALID_DOCUMENT,
  jsonResponse,
} from "../../../../helpers/access/client-id-metadata-fixtures";

describe("isClientIdMetadataDocumentUrl", () => {
  it("matches HTTPS URLs with a path component", () => {
    expect(isClientIdMetadataDocumentUrl("https://app.example.com/oauth/client.json")).toBe(true);
  });

  it("rejects HTTPS URLs without a path", () => {
    expect(isClientIdMetadataDocumentUrl("https://app.example.com")).toBe(false);
    expect(isClientIdMetadataDocumentUrl("https://app.example.com/")).toBe(false);
  });

  it("rejects non-HTTPS schemes", () => {
    expect(isClientIdMetadataDocumentUrl("http://app.example.com/x")).toBe(false);
    expect(isClientIdMetadataDocumentUrl("ftp://app.example.com/x")).toBe(false);
  });

  it("rejects URLs with fragments", () => {
    expect(isClientIdMetadataDocumentUrl("https://app.example.com/x#frag")).toBe(false);
  });

  it("rejects opaque (non-URL) client_ids", () => {
    expect(isClientIdMetadataDocumentUrl("client_abc123")).toBe(false);
    expect(isClientIdMetadataDocumentUrl("not a url")).toBe(false);
  });

  it("rejects an https-prefixed string that is not a valid URL", () => {
    expect(isClientIdMetadataDocumentUrl("https://")).toBe(false);
  });
});

describe("validateClientIdMetadataDocument", () => {
  it("accepts a well-formed document and returns required fields", () => {
    const result = validateClientIdMetadataDocument(VALID_DOCUMENT, VALID_DOCUMENT.client_id);
    expect(result.client_id).toBe(VALID_DOCUMENT.client_id);
    expect(result.client_name).toBe(VALID_DOCUMENT.client_name);
    expect(result.redirect_uris).toEqual(VALID_DOCUMENT.redirect_uris);
  });

  it("rejects when client_id does not match the document URL", () => {
    expect(() =>
      validateClientIdMetadataDocument(
        { ...VALID_DOCUMENT, client_id: "https://attacker.example/x" },
        VALID_DOCUMENT.client_id,
      ),
    ).toThrow(/client_id_mismatch|does not match/i);
  });

  it("rejects when client_id is missing", () => {
    const { client_id: _ignored, ...rest } = VALID_DOCUMENT;
    void _ignored;
    expect(() => validateClientIdMetadataDocument(rest, VALID_DOCUMENT.client_id)).toThrow(
      ClientIdMetadataError,
    );
  });

  it("rejects when redirect_uris is empty", () => {
    expect(() =>
      validateClientIdMetadataDocument(
        { ...VALID_DOCUMENT, redirect_uris: [] },
        VALID_DOCUMENT.client_id,
      ),
    ).toThrow(/redirect_uris/);
  });

  it("rejects http:// redirect_uris that aren't loopback", () => {
    expect(() =>
      validateClientIdMetadataDocument(
        { ...VALID_DOCUMENT, redirect_uris: ["http://attacker.example/cb"] },
        VALID_DOCUMENT.client_id,
      ),
    ).toThrow(/HTTPS or an http:\/\/localhost loopback/);
  });

  it("rejects token_endpoint_auth_method values other than 'none'", () => {
    expect(() =>
      validateClientIdMetadataDocument(
        { ...VALID_DOCUMENT, token_endpoint_auth_method: "client_secret_basic" },
        VALID_DOCUMENT.client_id,
      ),
    ).toThrow(/token_endpoint_auth_method/);
  });

  it("rejects when the response is not a JSON object", () => {
    expect(() => validateClientIdMetadataDocument([], VALID_DOCUMENT.client_id)).toThrow(
      /JSON object/,
    );
  });

  it("rejects when client_name is missing", () => {
    const { client_name: _ignored, ...rest } = VALID_DOCUMENT;
    void _ignored;
    expect(() => validateClientIdMetadataDocument(rest, VALID_DOCUMENT.client_id)).toThrow(
      /client_name/,
    );
  });

  it("rejects when redirect_uris contains a non-string entry", () => {
    expect(() =>
      validateClientIdMetadataDocument(
        { ...VALID_DOCUMENT, redirect_uris: [42] },
        VALID_DOCUMENT.client_id,
      ),
    ).toThrow(/redirect_uris/);
  });

  it("rejects when a redirect_uri is not a parseable URL", () => {
    expect(() =>
      validateClientIdMetadataDocument(
        { ...VALID_DOCUMENT, redirect_uris: ["::not a url::"] },
        VALID_DOCUMENT.client_id,
      ),
    ).toThrow(/is not a valid URL/);
  });
});

describe("resolveClientIdMetadataDocument", () => {
  it("rejects non-https client_ids without making a network call", async () => {
    let called = false;
    const fakeFetch: typeof fetch = () => {
      called = true;
      return Promise.resolve(new Response(""));
    };

    await expect(
      resolveClientIdMetadataDocument(
        "http://app.example.com/client.json",
        DEFAULT_CIMD_RESOLVER_OPTIONS,
        fakeFetch,
      ),
    ).rejects.toThrow(ClientIdMetadataError);
    expect(called).toBe(false);
  });

  it("rejects private IP addresses to prevent SSRF", async () => {
    const fakeFetch: typeof fetch = () => {
      throw new Error("fetch should not have been called");
    };

    await expect(
      resolveClientIdMetadataDocument(
        "https://127.0.0.1/internal/admin",
        DEFAULT_CIMD_RESOLVER_OPTIONS,
        fakeFetch,
      ),
    ).rejects.toThrow(/non-public host/);
  });

  it("enforces the configured host suffix allowlist", async () => {
    const fakeFetch: typeof fetch = () => Promise.resolve(jsonResponse(VALID_DOCUMENT));

    await expect(
      resolveClientIdMetadataDocument(
        VALID_DOCUMENT.client_id,
        { ...DEFAULT_CIMD_RESOLVER_OPTIONS, allowedHostSuffixes: ["other.test"] },
        fakeFetch,
      ),
    ).rejects.toThrow(/not in the configured allowlist/);
  });

  it("returns the validated document on success", async () => {
    const fakeFetch: typeof fetch = (url) => {
      expect(url).toBe(VALID_DOCUMENT.client_id);
      return Promise.resolve(jsonResponse(VALID_DOCUMENT));
    };

    const result = await resolveClientIdMetadataDocument(
      VALID_DOCUMENT.client_id,
      DEFAULT_CIMD_RESOLVER_OPTIONS,
      fakeFetch,
    );

    expect(result.client_name).toBe(VALID_DOCUMENT.client_name);
    expect(result.redirect_uris).toEqual(VALID_DOCUMENT.redirect_uris);
  });

  it("rejects bodies that exceed the size cap", async () => {
    const oversize = "x".repeat(20_000);
    const fakeFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(oversize, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(
      resolveClientIdMetadataDocument(
        VALID_DOCUMENT.client_id,
        { ...DEFAULT_CIMD_RESOLVER_OPTIONS, maxBytes: 1024 },
        fakeFetch,
      ),
    ).rejects.toThrow(/byte size cap/);
  });

  it("surfaces non-2xx responses as fetch_failed", async () => {
    const fakeFetch: typeof fetch = () =>
      Promise.resolve(new Response("not found", { status: 404 }));

    await expect(
      resolveClientIdMetadataDocument(
        VALID_DOCUMENT.client_id,
        DEFAULT_CIMD_RESOLVER_OPTIONS,
        fakeFetch,
      ),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("rejects unparseable client_id URLs without a network call", async () => {
    let called = false;
    const fakeFetch: typeof fetch = () => {
      called = true;
      return Promise.resolve(new Response(""));
    };

    await expect(
      resolveClientIdMetadataDocument("::not a url::", DEFAULT_CIMD_RESOLVER_OPTIONS, fakeFetch),
    ).rejects.toThrow(/CIMD client_id is not a valid URL/);
    expect(called).toBe(false);
  });

  it("rejects client_id URLs that contain a fragment", async () => {
    const fakeFetch: typeof fetch = () => Promise.resolve(jsonResponse(VALID_DOCUMENT));

    await expect(
      resolveClientIdMetadataDocument(
        "https://app.example.com/oauth/client.json#frag",
        DEFAULT_CIMD_RESOLVER_OPTIONS,
        fakeFetch,
      ),
    ).rejects.toThrow(/must not contain a fragment/);
  });

  it("wraps fetch errors as fetch_failed", async () => {
    const fakeFetch: typeof fetch = () => Promise.reject(new Error("network down"));

    await expect(
      resolveClientIdMetadataDocument(
        VALID_DOCUMENT.client_id,
        DEFAULT_CIMD_RESOLVER_OPTIONS,
        fakeFetch,
      ),
    ).rejects.toThrow(/network down/);
  });

  it("wraps non-Error fetch rejections as fetch_failed", async () => {
    const fakeFetch: typeof fetch = () =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- intentionally rejecting with a non-Error value
      Promise.reject("nope");

    await expect(
      resolveClientIdMetadataDocument(
        VALID_DOCUMENT.client_id,
        DEFAULT_CIMD_RESOLVER_OPTIONS,
        fakeFetch,
      ),
    ).rejects.toThrow(/nope/);
  });

  it("rejects responses with no body stream", async () => {
    const fakeFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(
      resolveClientIdMetadataDocument(
        VALID_DOCUMENT.client_id,
        DEFAULT_CIMD_RESOLVER_OPTIONS,
        fakeFetch,
      ),
    ).rejects.toThrow(/no body/);
  });

  it("rejects bodies that are not valid JSON", async () => {
    const fakeFetch: typeof fetch = () =>
      Promise.resolve(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(
      resolveClientIdMetadataDocument(
        VALID_DOCUMENT.client_id,
        DEFAULT_CIMD_RESOLVER_OPTIONS,
        fakeFetch,
      ),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("matches an explicit allowlist suffix on the document host", async () => {
    const fakeFetch: typeof fetch = () => Promise.resolve(jsonResponse(VALID_DOCUMENT));

    const result = await resolveClientIdMetadataDocument(
      VALID_DOCUMENT.client_id,
      {
        ...DEFAULT_CIMD_RESOLVER_OPTIONS,
        allowedHostSuffixes: ["", "example.com"],
      },
      fakeFetch,
    );

    expect(result.client_id).toBe(VALID_DOCUMENT.client_id);
  });

  it("skips empty chunks while streaming the response body", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify(VALID_DOCUMENT).slice(0, 10)));
        // An empty chunk forces the `if (!value) continue;` branch.
        controller.enqueue(new Uint8Array());
        controller.enqueue(encoder.encode(JSON.stringify(VALID_DOCUMENT).slice(10)));
        controller.close();
      },
    });

    const fakeFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const result = await resolveClientIdMetadataDocument(
      VALID_DOCUMENT.client_id,
      DEFAULT_CIMD_RESOLVER_OPTIONS,
      fakeFetch,
    );

    expect(result.client_id).toBe(VALID_DOCUMENT.client_id);
  });

  it("aborts the request when the configured timeout elapses", async () => {
    const fakeFetch: typeof fetch = (_url, init) =>
      new Promise((_, reject) => {
        const signal = (init as { signal?: AbortSignal }).signal;
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });

    await expect(
      resolveClientIdMetadataDocument(
        VALID_DOCUMENT.client_id,
        { ...DEFAULT_CIMD_RESOLVER_OPTIONS, timeoutMs: 5 },
        fakeFetch,
      ),
    ).rejects.toThrow(/aborted/);
  });

  it("aborts the body stream when its size exceeds the cap", async () => {
    let cancelCalled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2048));
        controller.enqueue(new Uint8Array(2048));
        controller.close();
      },
      cancel() {
        cancelCalled = true;
      },
    });

    const fakeFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(
      resolveClientIdMetadataDocument(
        VALID_DOCUMENT.client_id,
        { ...DEFAULT_CIMD_RESOLVER_OPTIONS, maxBytes: 1024 },
        fakeFetch,
      ),
    ).rejects.toThrow(/byte size cap/);
    expect(cancelCalled).toBe(true);
  });

  it("swallows cancel rejections when the body exceeds the size cap", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2048));
        controller.enqueue(new Uint8Array(2048));
        controller.close();
      },
      cancel() {
        throw new Error("cancel failed");
      },
    });

    const fakeFetch: typeof fetch = () =>
      Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(
      resolveClientIdMetadataDocument(
        VALID_DOCUMENT.client_id,
        { ...DEFAULT_CIMD_RESOLVER_OPTIONS, maxBytes: 1024 },
        fakeFetch,
      ),
    ).rejects.toThrow(/byte size cap/);
  });
});
