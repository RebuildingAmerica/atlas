import { describe, expect, it } from "vitest";
import {
  deriveSoloWorkspaceSlug,
  resolveReadyDestination,
} from "@/domains/access/pages/auth/account-setup-helpers";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../../fixtures/access/sessions";

describe("deriveSoloWorkspaceSlug", () => {
  it("uses the operator's name for the workspace name when available", () => {
    expect(deriveSoloWorkspaceSlug("Atlas Operator")).toEqual({
      name: "Atlas Operator's Workspace",
      slug: "atlas-operator-s-workspace",
    });
  });

  it("falls back to a generic label when the operator has no name", () => {
    expect(deriveSoloWorkspaceSlug(null)).toEqual({
      name: "My Workspace",
      slug: "my-workspace",
    });
    expect(deriveSoloWorkspaceSlug(undefined)).toEqual({
      name: "My Workspace",
      slug: "my-workspace",
    });
    expect(deriveSoloWorkspaceSlug("")).toEqual({
      name: "My Workspace",
      slug: "my-workspace",
    });
  });

  it("strips characters that are illegal in slugs", () => {
    expect(deriveSoloWorkspaceSlug("R&D / Skunkworks!").slug).toBe("r-d-skunkworks-s-workspace");
  });
});

describe("resolveReadyDestination", () => {
  it("sends operators with pending invitations to /organization", () => {
    const session = createAtlasSessionFixture({
      workspace: createAtlasWorkspace({ onboarding: { hasPendingInvitations: true } }),
    });
    expect(resolveReadyDestination(session, "/account")).toBe("/organization");
  });

  it("honors the explicit redirectTo when there are no pending invitations", () => {
    const session = createAtlasSessionFixture();
    expect(resolveReadyDestination(session, "/account")).toBe("/account");
  });

  it("falls back to /discovery when redirectTo is omitted", () => {
    const session = createAtlasSessionFixture();
    expect(resolveReadyDestination(session)).toBe("/discovery");
  });
});
