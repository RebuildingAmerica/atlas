// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseSamlIdpMetadata } from "@/domains/access/saml-metadata-parser";

const COMPLETE_METADATA = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
    entityID="https://idp.example/saml2">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>MIIDazCCAlOgAwIBAgIUExampleSigningCertBytesAAAAAAAAAAAAAAAAAAAAAA</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="https://idp.example/saml2/post" />
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
        Location="https://idp.example/saml2/redirect" />
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

describe("parseSamlIdpMetadata", () => {
  it("extracts issuer, redirect-binding entry point, and signing certificate", () => {
    const result = parseSamlIdpMetadata(COMPLETE_METADATA);

    if (!result.ok) {
      throw new Error(`Expected parse to succeed, got error: ${result.error}`);
    }

    expect(result.metadata.issuer).toBe("https://idp.example/saml2");
    expect(result.metadata.entryPoint).toBe("https://idp.example/saml2/redirect");
    expect(result.metadata.certificate).toContain("-----BEGIN CERTIFICATE-----");
    expect(result.metadata.certificate).toContain("-----END CERTIFICATE-----");
    expect(result.metadata.certificate).toContain("MIIDazCCAlOgAwIBAgIUExampleSigningCertBytes");
  });

  it("returns the HTTP-POST entry point when no redirect binding is present", () => {
    const postOnly = COMPLETE_METADATA.replace(
      /<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"\s+Location="https:\/\/idp.example\/saml2\/redirect" \/>/,
      "",
    );

    const result = parseSamlIdpMetadata(postOnly);

    if (!result.ok) {
      throw new Error(`Expected parse to succeed, got error: ${result.error}`);
    }

    expect(result.metadata.entryPoint).toBe("https://idp.example/saml2/post");
  });

  it("rejects empty input", () => {
    const result = parseSamlIdpMetadata("   ");
    expect(result.ok).toBe(false);
  });

  it("rejects malformed XML", () => {
    const result = parseSamlIdpMetadata("<EntityDescriptor>oops");
    expect(result.ok).toBe(false);
  });

  it("rejects XML that does not contain an EntityDescriptor", () => {
    const result = parseSamlIdpMetadata("<rss><channel/></rss>");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/EntityDescriptor/);
    }
  });
});
