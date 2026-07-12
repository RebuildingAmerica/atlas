// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  deriveSoloWorkspaceSlug,
  resolveReadyDestination,
  useRelativeTimestamp,
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

  it("rejects protocol-relative redirect targets", () => {
    const session = createAtlasSessionFixture();
    expect(resolveReadyDestination(session, "//evil.example")).toBe("/discovery");
  });
});

describe("useRelativeTimestamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when no timestamp is provided", () => {
    const { result } = renderHook(() => useRelativeTimestamp(null));
    expect(result.current).toBeNull();
  });

  it("renders 'just now' for fresh timestamps", () => {
    const now = Date.now();
    const { result } = renderHook(() => useRelativeTimestamp(now - 2_000));
    expect(result.current).toBe("just now");
  });

  it("renders the seconds-ago label and updates as the timer ticks", () => {
    const now = Date.now();
    const { result } = renderHook(() => useRelativeTimestamp(now - 30_000));
    expect(result.current).toBe("30s ago");
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe("1m ago");
  });

  it("renders the minutes-ago label for stale timestamps", () => {
    const now = Date.now();
    const { result } = renderHook(() => useRelativeTimestamp(now - 7 * 60_000));
    expect(result.current).toBe("7m ago");
  });
});
