import { describe, expect, it } from "vitest";
import { suggestEmailDomainCorrection } from "@/domains/access/email-domain-suggestions";

describe("suggestEmailDomainCorrection", () => {
  it("returns null for blank or partial inputs", () => {
    expect(suggestEmailDomainCorrection("")).toBeNull();
    expect(suggestEmailDomainCorrection("user@")).toBeNull();
    expect(suggestEmailDomainCorrection("user")).toBeNull();
  });

  it("returns null when the domain is already correct", () => {
    expect(suggestEmailDomainCorrection("user@gmail.com")).toBeNull();
    expect(suggestEmailDomainCorrection("user@outlook.com")).toBeNull();
  });

  it("suggests a correction for a one-edit-away typo", () => {
    expect(suggestEmailDomainCorrection("user@gmial.com")).toBe("user@gmail.com");
    expect(suggestEmailDomainCorrection("user@hotnail.com")).toBe("user@hotmail.com");
  });

  it("returns null when the typed domain is far from any known one", () => {
    expect(suggestEmailDomainCorrection("user@acme.example")).toBeNull();
  });
});
