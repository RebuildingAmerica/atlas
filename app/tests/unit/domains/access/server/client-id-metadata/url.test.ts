import { describe, expect, it } from "vitest";

import { isClientIdMetadataDocumentUrl } from "@/domains/access/server/client-id-metadata";

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
