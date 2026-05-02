import { describe, expect, it } from "vitest";
import {
  DNS_PROVIDER_GUIDES,
  splitVerificationHost,
} from "@/domains/access/dns-verification-helpers";

describe("splitVerificationHost", () => {
  it("returns blank fields when the verification host is empty", () => {
    expect(splitVerificationHost("", "atlas.example")).toEqual({ fqdn: "", relative: "" });
    expect(splitVerificationHost("   ", "atlas.example")).toEqual({ fqdn: "", relative: "" });
  });

  it("splits an FQDN that already includes the workspace domain", () => {
    expect(splitVerificationHost("_better-auth-token-abc.atlas.example", "atlas.example")).toEqual({
      fqdn: "_better-auth-token-abc.atlas.example",
      relative: "_better-auth-token-abc",
    });
  });

  it("treats a host equal to the workspace domain as the apex", () => {
    expect(splitVerificationHost("atlas.example", "Atlas.Example")).toEqual({
      fqdn: "atlas.example",
      relative: "@",
    });
  });

  it("appends the workspace domain when the host is relative", () => {
    expect(splitVerificationHost("_better-auth-token-abc", "atlas.example")).toEqual({
      fqdn: "_better-auth-token-abc.atlas.example",
      relative: "_better-auth-token-abc",
    });
  });

  it("returns the trimmed host as both fqdn and relative when no workspace domain is given", () => {
    expect(splitVerificationHost("_better-auth-token-abc", "")).toEqual({
      fqdn: "_better-auth-token-abc",
      relative: "_better-auth-token-abc",
    });
  });
});

describe("DNS_PROVIDER_GUIDES", () => {
  it("includes the documented Cloudflare, Route 53, Cloud DNS, and GoDaddy entries", () => {
    const ids = DNS_PROVIDER_GUIDES.map((guide) => guide.id);
    expect(ids).toEqual(["cloudflare", "route53", "google-domains", "godaddy"]);
  });
});
