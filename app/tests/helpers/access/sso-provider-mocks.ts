import type { vi } from "vitest";

export interface MockPool {
  query: ReturnType<typeof vi.fn>;
}

export interface MockSqliteDatabase {
  prepare: ReturnType<typeof vi.fn>;
}

export interface OrganizationPluginConfig {
  schema: {
    organization: { additionalFields: Record<string, unknown> };
    member: { additionalFields: Record<string, unknown> };
    invitation: { additionalFields: Record<string, unknown> };
  };
  sendInvitationEmail: (input: {
    email: string;
    organization: { name: string };
    inviter: { user: { email: string } };
    invitation: { id: string };
  }) => Promise<unknown>;
}

export interface OrganizationPendingInvitationPluginConfig {
  sendInvitationEmail: (params: {
    email: string;
    id: string;
    organization: { name: string };
  }) => Promise<void>;
}
