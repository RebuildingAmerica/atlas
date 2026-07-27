import type { AtlasSessionPayload } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import type { AtlasAuthAdapter, AtlasAuthInternalAdapter } from "@/domains/access/server/auth";

/** A user row as the fake Better Auth store keeps it. */
export interface StoredUser {
  email: string;
  emailVerified: boolean;
  id: string;
  name: string;
}

/** A membership row as the fake Better Auth store keeps it. */
export interface StoredMember {
  id: string;
  organizationId: string;
  role: string;
  userId: string;
}

interface WhereClause {
  field: string;
  value: unknown;
}

interface FindOneArgs {
  model: string;
  where: WhereClause[];
}

interface UpdateArgs {
  model: string;
  update: Record<string, unknown>;
  where: WhereClause[];
}

interface CreateArgs {
  data: Record<string, unknown>;
  model: string;
}

export interface FakeAuthStoreOptions {
  /** Rows the store already holds before the request under test runs. */
  members?: StoredMember[];
  /** Replaces the member lookup result, to simulate an adapter contract break. */
  memberLookupOverride?: unknown;
  users?: StoredUser[];
}

export interface FakeAuthStore {
  auth: Awaited<ReturnType<typeof buildFakeAuth>>;
  members: StoredMember[];
  users: StoredUser[];
}

function matches(row: Record<string, unknown>, where: WhereClause[]): boolean {
  return where.every((clause) => row[clause.field] === clause.value);
}

function buildFakeAuth(
  users: StoredUser[],
  members: StoredMember[],
  options: FakeAuthStoreOptions,
) {
  const internalAdapter = {
    createUser: (data: StoredUser) => {
      users.push({ ...data });
      return Promise.resolve(data);
    },
    findUserByEmail: (email: string) => {
      const user = users.find((candidate) => candidate.email === email);
      return Promise.resolve(user ? { user } : null);
    },
    updateUser: (id: string, data: Partial<StoredUser>) => {
      const user = users.find((candidate) => candidate.id === id);
      if (user) Object.assign(user, data);
      return Promise.resolve(user ?? null);
    },
  } as unknown as AtlasAuthInternalAdapter;

  const adapter = {
    create: ({ data }: CreateArgs) => {
      members.push(data as unknown as StoredMember);
      return Promise.resolve(data);
    },
    findOne: ({ where }: FindOneArgs) => {
      if ("memberLookupOverride" in options) {
        return Promise.resolve(options.memberLookupOverride);
      }
      return Promise.resolve(
        members.find((member) => matches(member as unknown as Record<string, unknown>, where)) ??
          null,
      );
    },
    update: ({ update, where }: UpdateArgs) => {
      const member = members.find((candidate) =>
        matches(candidate as unknown as Record<string, unknown>, where),
      );
      if (member) Object.assign(member, update);
      return Promise.resolve(member ?? null);
    },
  } as unknown as AtlasAuthAdapter;

  return { $context: Promise.resolve({ adapter, internalAdapter }) };
}

/**
 * Builds an in-memory stand-in for the Better Auth storage the E2E seeding
 * route writes through, so tests can assert on the rows that end up stored
 * rather than on which adapter methods were called.
 *
 * @param options - Pre-existing rows and optional adapter misbehaviour.
 */
export function createFakeAuthStore(options: FakeAuthStoreOptions = {}): FakeAuthStore {
  const users = [...(options.users ?? [])];
  const members = [...(options.members ?? [])];
  return { auth: buildFakeAuth(users, members, options), members, users };
}

/**
 * Builds the session payload the seeding route reads its active workspace from.
 *
 * @param role - The caller's role in the active workspace.
 * @param organizationId - The active workspace id.
 */
export function sessionWithWorkspaceRole(
  role: string,
  organizationId = "org_e2e",
): AtlasSessionPayload {
  return {
    accountReady: true,
    hasPasskey: true,
    isLocal: false,
    passkeyCount: 1,
    session: { id: "session_1" },
    user: {
      email: "owner@atlas.test",
      emailVerified: true,
      id: "user_owner",
      name: "Owner",
    },
    workspace: {
      activeOrganization: { id: organizationId, name: "Atlas E2E", role, slug: "atlas-e2e" },
    },
  } as unknown as AtlasSessionPayload;
}
