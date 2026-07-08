import { describe, expect, it } from "vitest";

import { validateClientIdMetadataDocument } from "@/domains/access/server/client-id-metadata";
import { VALID_DOCUMENT } from "./support";

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
      /client_id/,
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
