// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearClaimDraft,
  loadClaimDraft,
  saveClaimDraft,
  type ClaimDraft,
} from "@/routes/_public/claim/claim-draft";

describe("claim draft storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("restores same-tab claim state and clears it explicitly", () => {
    const draft: ClaimDraft = {
      atprotoIdentityId: "identity_1",
      dnsDomain: "example.org",
      evidence: "Public staff page",
      preferredContactChannel: "email",
      privateNote: "Private context",
      relationship: "self",
      requestedChanges: "Update my role",
      useActiveWorkspace: false,
    };
    saveClaimDraft("person", draft);

    expect(loadClaimDraft("person")).toEqual(draft);
    expect(loadClaimDraft("other-person")).toBeNull();

    clearClaimDraft("person");
    expect(loadClaimDraft("person")).toBeNull();
  });

  it("ignores corrupt or incomplete draft data", () => {
    window.sessionStorage.setItem("atlas:claim-draft:bad-json", "{");
    window.sessionStorage.setItem(
      "atlas:claim-draft:incomplete",
      JSON.stringify({ relationship: "self" }),
    );

    expect(loadClaimDraft("bad-json")).toBeNull();
    expect(loadClaimDraft("incomplete")).toBeNull();
  });

  it("ignores primitive draft data", () => {
    window.sessionStorage.setItem("atlas:claim-draft:null", "null");

    expect(loadClaimDraft("null")).toBeNull();
  });

  it("treats draft storage as unavailable during server rendering", () => {
    vi.stubGlobal("window", undefined);

    expect(loadClaimDraft("person")).toBeNull();
    expect(() => {
      saveClaimDraft("person", {
        atprotoIdentityId: "",
        dnsDomain: "",
        evidence: "",
        preferredContactChannel: "",
        privateNote: "",
        relationship: "self",
        requestedChanges: "",
        useActiveWorkspace: false,
      });
      clearClaimDraft("person");
    }).not.toThrow();
  });
});
