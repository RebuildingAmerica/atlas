import { describe, expect, it } from "vitest";
import { suggestEmailDomainCorrection } from "@rebuildingamerica/atlas-access/email-domain-suggestions";

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

  it("trims whitespace and lowercases the input before comparing", () => {
    expect(suggestEmailDomainCorrection("  USER@GMIAL.COM  ")).toBe("user@gmail.com");
  });

  it("hits each levenshtein edit branch with characteristic typos", () => {
    // Equal-length substitution branch.
    expect(suggestEmailDomainCorrection("user@gmail.con")).toBe("user@gmail.com");
    // Extra-character (deletion) branch.
    expect(suggestEmailDomainCorrection("user@gmaill.com")).toBe("user@gmail.com");
    // Missing-character (insertion) branch.
    expect(suggestEmailDomainCorrection("user@gmal.com")).toBe("user@gmail.com");
  });

  it("returns null when the input has no domain after the @", () => {
    expect(suggestEmailDomainCorrection("user@")).toBeNull();
  });
});
