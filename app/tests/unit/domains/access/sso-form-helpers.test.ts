import { describe, expect, it } from "vitest";
import {
  classifyPemCertificate,
  extractIssuerOrigin,
  isLikelyFreeEmailDomain,
} from "@/domains/access/sso-form-helpers";

describe("isLikelyFreeEmailDomain", () => {
  it("returns true for the consumer-mailbox hosts in the allowlist", () => {
    expect(isLikelyFreeEmailDomain("gmail.com")).toBe(true);
    expect(isLikelyFreeEmailDomain(" Outlook.com ")).toBe(true);
    expect(isLikelyFreeEmailDomain("YAHOO.COM")).toBe(true);
  });

  it("returns false for company domains", () => {
    expect(isLikelyFreeEmailDomain("atlas.example")).toBe(false);
    expect(isLikelyFreeEmailDomain("rebuildingus.org")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isLikelyFreeEmailDomain("")).toBe(false);
    expect(isLikelyFreeEmailDomain("   ")).toBe(false);
  });
});

describe("classifyPemCertificate", () => {
  it("returns empty for blank input", () => {
    expect(classifyPemCertificate("")).toEqual({ kind: "empty" });
    expect(classifyPemCertificate("   \n   ")).toEqual({ kind: "empty" });
  });

  it("flags missing BEGIN header", () => {
    const result = classifyPemCertificate("nope\nMIIDazCC\n-----END CERTIFICATE-----");
    expect(result).toEqual({
      kind: "invalid",
      reason: "Certificate is missing the -----BEGIN CERTIFICATE----- header.",
    });
  });

  it("flags missing END footer", () => {
    const result = classifyPemCertificate("-----BEGIN CERTIFICATE-----\nMIIDazCC\nnope");
    expect(result).toEqual({
      kind: "invalid",
      reason: "Certificate is missing the -----END CERTIFICATE----- footer.",
    });
  });

  it("flags an empty body", () => {
    const result = classifyPemCertificate(
      "-----BEGIN CERTIFICATE-----\n   \n-----END CERTIFICATE-----",
    );
    expect(result).toEqual({ kind: "invalid", reason: "Certificate body is empty." });
  });

  it("flags non-base64 body characters", () => {
    const result = classifyPemCertificate(
      "-----BEGIN CERTIFICATE-----\n!!!not-base64\n-----END CERTIFICATE-----",
    );
    expect(result).toEqual({
      kind: "invalid",
      reason: "Certificate body has non-base64 characters.",
    });
  });

  it("returns ok with bodyLines count for valid PEM", () => {
    const result = classifyPemCertificate(
      "-----BEGIN CERTIFICATE-----\nMIIDazCCAlOgAwIBAgIUExample\nAAAAAAAAAAAAAAAAAAAAAAAA\n-----END CERTIFICATE-----",
    );
    expect(result).toEqual({ kind: "ok", bodyLines: 2 });
  });
});

describe("extractIssuerOrigin", () => {
  it("returns the origin for a valid URL", () => {
    expect(extractIssuerOrigin("https://idp.example/saml2?idpid=abc")).toBe("https://idp.example");
    expect(extractIssuerOrigin(" https://idp.example:8443/saml ")).toBe("https://idp.example:8443");
  });

  it("returns null for empty input", () => {
    expect(extractIssuerOrigin("")).toBeNull();
    expect(extractIssuerOrigin("   ")).toBeNull();
  });

  it("returns null for unparseable URLs", () => {
    expect(extractIssuerOrigin("not-a-url")).toBeNull();
    expect(extractIssuerOrigin("//missing-protocol")).toBeNull();
  });
});
