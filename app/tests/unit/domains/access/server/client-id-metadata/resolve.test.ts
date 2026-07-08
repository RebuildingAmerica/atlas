import { describe, expect, it } from "vitest";

import {
  ClientIdMetadataError,
  DEFAULT_CIMD_RESOLVER_OPTIONS,
  resolveClientIdMetadataDocument,
} from "@/domains/access/server/client-id-metadata";
import { VALID_DOCUMENT, jsonResponse } from "./support";

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

  it.each([
    "https://[fc00::1]/client.json",
    "https://[fd12:3456::1]/client.json",
    "https://[fe80::1]/client.json",
  ])("rejects private IPv6 client_id host %s before fetching", async (clientId) => {
    let called = false;
    const fakeFetch: typeof fetch = () => {
      called = true;
      return Promise.resolve(jsonResponse(VALID_DOCUMENT));
    };

    await expect(
      resolveClientIdMetadataDocument(clientId, DEFAULT_CIMD_RESOLVER_OPTIONS, fakeFetch),
    ).rejects.toThrow(/non-public host/);
    expect(called).toBe(false);
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
