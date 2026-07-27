import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAuthReady: vi.fn(),
  requireAtlasSessionState: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => ({ ensureAuthReady: mocks.ensureAuthReady }));
vi.mock("@/domains/access/server/session-state", () => ({
  requireAtlasSessionState: mocks.requireAtlasSessionState,
}));

import { seedE2EWorkspaceMember } from "@/domains/access/server/e2e-workspace-member";
import { createFakeAuthStore, sessionWithWorkspaceRole } from "./e2e-workspace-member-test-support";

describe("seedE2EWorkspaceMember", () => {
  beforeEach(() => {
    vi.stubEnv("ATLAS_E2E_WORKSPACE_SEED_ENABLED", "1");
    vi.stubEnv("ATLAS_E2E_INTERNAL_SECRET", "seed-secret");
    mocks.requireAtlasSessionState.mockResolvedValue(sessionWithWorkspaceRole("owner"));
  });

  it("creates a verified member the second browser account can sign in as", async () => {
    const store = createFakeAuthStore();
    mocks.ensureAuthReady.mockResolvedValue(store.auth);

    const response = await seedE2EWorkspaceMember(
      new Request("https://atlas.test/internal/e2e/workspace-member", {
        body: JSON.stringify({ email: "Teammate@Atlas.Test", name: "Teammate" }),
        headers: { "x-atlas-e2e-secret": "seed-secret" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { email: string; name: string; userId: string };
    expect(body).toEqual({
      email: "teammate@atlas.test",
      name: "Teammate",
      userId: expect.stringMatching(/^e2e_user_/) as string,
    });
    expect(store.users).toEqual([
      {
        email: "teammate@atlas.test",
        emailVerified: true,
        id: body.userId,
        image: null,
        name: "Teammate",
      },
    ]);
    expect(store.members).toEqual([
      {
        createdAt: expect.any(Date) as Date,
        id: expect.stringMatching(/^e2e_member_/) as string,
        organizationId: "org_e2e",
        role: "member",
        userId: body.userId,
      },
    ]);
  });

  it("re-verifies and renames an existing account instead of duplicating it", async () => {
    const store = createFakeAuthStore({
      users: [
        {
          email: "teammate@atlas.test",
          emailVerified: false,
          id: "user_existing",
          name: "Stale Name",
        },
      ],
    });
    mocks.ensureAuthReady.mockResolvedValue(store.auth);

    const response = await seedE2EWorkspaceMember(
      new Request("https://atlas.test/internal/e2e/workspace-member", {
        body: JSON.stringify({ email: "teammate@atlas.test", name: "Fresh Name" }),
        headers: { "x-atlas-e2e-secret": "seed-secret" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ userId: "user_existing" });
    expect(store.users).toEqual([
      {
        email: "teammate@atlas.test",
        emailVerified: true,
        id: "user_existing",
        name: "Fresh Name",
      },
    ]);
  });

  it("demotes an existing membership back to plain member", async () => {
    const store = createFakeAuthStore({
      members: [
        { id: "member_1", organizationId: "org_e2e", role: "admin", userId: "user_existing" },
      ],
      users: [
        {
          email: "teammate@atlas.test",
          emailVerified: true,
          id: "user_existing",
          name: "Teammate",
        },
      ],
    });
    mocks.ensureAuthReady.mockResolvedValue(store.auth);

    await seedE2EWorkspaceMember(
      new Request("https://atlas.test/internal/e2e/workspace-member", {
        body: JSON.stringify({ email: "teammate@atlas.test", name: "Teammate" }),
        headers: { "x-atlas-e2e-secret": "seed-secret" },
        method: "POST",
      }),
    );

    expect(store.members).toEqual([
      { id: "member_1", organizationId: "org_e2e", role: "member", userId: "user_existing" },
    ]);
  });

  it("refuses to guess a member id when the adapter returns an unexpected shape", async () => {
    const store = createFakeAuthStore({ memberLookupOverride: { role: "member" } });
    mocks.ensureAuthReady.mockResolvedValue(store.auth);

    await expect(
      seedE2EWorkspaceMember(
        new Request("https://atlas.test/internal/e2e/workspace-member", {
          body: JSON.stringify({ email: "teammate@atlas.test", name: "Teammate" }),
          headers: { "x-atlas-e2e-secret": "seed-secret" },
          method: "POST",
        }),
      ),
    ).rejects.toThrow("E2E member lookup did not return a member id.");
  });

  it("hides the route when the E2E harness is not switched on", async () => {
    vi.stubEnv("ATLAS_E2E_WORKSPACE_SEED_ENABLED", "");

    const response = await seedE2EWorkspaceMember(
      new Request("https://atlas.test/internal/e2e/workspace-member", {
        body: JSON.stringify({ email: "teammate@atlas.test", name: "Teammate" }),
        headers: { "x-atlas-e2e-secret": "seed-secret" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "E2E workspace member seeding is unavailable.",
    });
    expect(mocks.ensureAuthReady).not.toHaveBeenCalled();
  });

  it("hides the route when no seeding secret is configured", async () => {
    vi.stubEnv("ATLAS_E2E_INTERNAL_SECRET", "  ");

    const response = await seedE2EWorkspaceMember(
      new Request("https://atlas.test/internal/e2e/workspace-member", {
        body: JSON.stringify({ email: "teammate@atlas.test", name: "Teammate" }),
        headers: { "x-atlas-e2e-secret": "seed-secret" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
  });

  it("hides the route from a request carrying the wrong secret", async () => {
    const response = await seedE2EWorkspaceMember(
      new Request("https://atlas.test/internal/e2e/workspace-member", {
        body: JSON.stringify({ email: "teammate@atlas.test", name: "Teammate" }),
        headers: { "x-atlas-e2e-secret": "guessed" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
  });

  it("hides the route from a request carrying no secret at all", async () => {
    const response = await seedE2EWorkspaceMember(
      new Request("https://atlas.test/internal/e2e/workspace-member", {
        body: JSON.stringify({ email: "teammate@atlas.test", name: "Teammate" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
  });

  it("refuses seeding from a workspace member who cannot administer identity", async () => {
    mocks.requireAtlasSessionState.mockResolvedValue(sessionWithWorkspaceRole("member"));
    const store = createFakeAuthStore();
    mocks.ensureAuthReady.mockResolvedValue(store.auth);

    const response = await seedE2EWorkspaceMember(
      new Request("https://atlas.test/internal/e2e/workspace-member", {
        body: JSON.stringify({ email: "teammate@atlas.test", name: "Teammate" }),
        headers: { "x-atlas-e2e-secret": "seed-secret" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Workspace member seeding is unavailable.",
    });
    expect(store.users).toEqual([]);
  });

  it("rejects a payload that is not a usable identity", async () => {
    await expect(
      seedE2EWorkspaceMember(
        new Request("https://atlas.test/internal/e2e/workspace-member", {
          body: JSON.stringify({ email: "not-an-email", name: "Teammate" }),
          headers: { "x-atlas-e2e-secret": "seed-secret" },
          method: "POST",
        }),
      ),
    ).rejects.toThrow();

    await expect(
      seedE2EWorkspaceMember(
        new Request("https://atlas.test/internal/e2e/workspace-member", {
          body: JSON.stringify({ email: "teammate@atlas.test", name: "   " }),
          headers: { "x-atlas-e2e-secret": "seed-secret" },
          method: "POST",
        }),
      ),
    ).rejects.toThrow();
  });
});
