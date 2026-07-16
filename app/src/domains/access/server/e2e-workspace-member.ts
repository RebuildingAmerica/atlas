import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canManageAtlasOrganizationRole } from "@rebuildingamerica/atlas-access/workspace/organization-metadata";
import { requireActiveWorkspace } from "../organization-server-helpers";
import { ensureAuthReady, type AtlasAuthAdapter, type AtlasAuthInternalAdapter } from "./auth";
import { requireAtlasSessionState } from "./session-state";

interface MemberRecord {
  id: string;
}

const seedWorkspaceMemberPayloadSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(80),
});

function isMemberRecord(value: unknown): value is MemberRecord {
  return (
    typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function upsertE2EUser(
  internalAdapter: AtlasAuthInternalAdapter,
  input: {
    email: string;
    name: string;
  },
): Promise<string> {
  const normalizedEmail = normalizeEmail(input.email);
  const existingByEmail = await internalAdapter.findUserByEmail(normalizedEmail);
  if (existingByEmail) {
    await internalAdapter.updateUser(existingByEmail.user.id, {
      email: normalizedEmail,
      emailVerified: true,
      name: input.name,
    });
    return existingByEmail.user.id;
  }

  const userId = `e2e_user_${randomUUID()}`;
  await internalAdapter.createUser({
    email: normalizedEmail,
    emailVerified: true,
    id: userId,
    image: null,
    name: input.name,
  });
  return userId;
}

async function upsertE2EMembership(
  adapter: AtlasAuthAdapter,
  input: {
    organizationId: string;
    userId: string;
  },
): Promise<void> {
  const existingMember = await adapter.findOne({
    model: "member",
    where: [
      { field: "organizationId", value: input.organizationId },
      { field: "userId", value: input.userId },
    ],
  });
  if (existingMember) {
    if (!isMemberRecord(existingMember)) {
      throw new Error("E2E member lookup did not return a member id.");
    }
    await adapter.update({
      model: "member",
      update: { role: "member" },
      where: [{ field: "id", value: existingMember.id }],
    });
    return;
  }

  await adapter.create({
    forceAllowId: true,
    model: "member",
    data: {
      createdAt: new Date(),
      id: `e2e_member_${randomUUID()}`,
      organizationId: input.organizationId,
      role: "member",
      userId: input.userId,
    },
  });
}

function assertE2ESeedAuthorized(request: Request): Response | null {
  const seedEnabled = process.env.ATLAS_E2E_WORKSPACE_SEED_ENABLED === "1";
  const expectedSecret = process.env.ATLAS_E2E_INTERNAL_SECRET?.trim();
  const actualSecret = request.headers.get("x-atlas-e2e-secret")?.trim();
  if (!seedEnabled || !expectedSecret || actualSecret !== expectedSecret) {
    return Response.json(
      { error: "E2E workspace member seeding is unavailable." },
      { status: 404 },
    );
  }
  return null;
}

/**
 * Seeds a verified member on the current E2E workspace so acceptance can prove
 * delegated organization identity administration with two real browser
 * accounts. This route is unavailable outside the explicit ATProto E2E harness.
 */
export async function seedE2EWorkspaceMember(request: Request): Promise<Response> {
  const unauthorized = assertE2ESeedAuthorized(request);
  if (unauthorized) return unauthorized;

  const payload = seedWorkspaceMemberPayloadSchema.parse(await request.json());
  const session = await requireAtlasSessionState();
  const activeWorkspace = requireActiveWorkspace(session);
  if (!canManageAtlasOrganizationRole(activeWorkspace.role)) {
    return Response.json({ error: "Workspace member seeding is unavailable." }, { status: 404 });
  }

  const auth = await ensureAuthReady();
  const context = await auth.$context;
  const userId = await upsertE2EUser(context.internalAdapter, {
    email: payload.email,
    name: payload.name,
  });
  await upsertE2EMembership(context.adapter, {
    organizationId: activeWorkspace.id,
    userId,
  });

  return Response.json(
    {
      email: normalizeEmail(payload.email),
      name: payload.name,
      userId,
    },
    { status: 201 },
  );
}
