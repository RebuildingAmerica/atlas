import type { AtlasWorkspaceCapabilities, AtlasWorkspaceType } from "./organization-metadata";

/**
 * Lightweight organization summary attached to a session.
 *
 * This is the stable shape routes and layouts use for workspace switching and
 * feature gating without fetching full member or invitation lists.
 */
export interface AtlasWorkspaceMembership {
  id: string;
  name: string;
  role: string;
  slug: string;
  workspaceType: AtlasWorkspaceType;
}

/**
 * Pending invitation details that let Atlas explain available workspaces
 * before the user has accepted them.
 */
export interface AtlasWorkspaceInvitation {
  email: string;
  expiresAt: string | null;
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: string;
  workspaceType: AtlasWorkspaceType;
}

/**
 * Workspace context bundled into every normalized Atlas session payload.
 *
 * This keeps navigation, progressive enhancement, and onboarding decisions in
 * sync everywhere that consumes session state.
 */
export interface AtlasWorkspaceState {
  activeOrganization: AtlasWorkspaceMembership | null;
  capabilities: AtlasWorkspaceCapabilities;
  memberships: AtlasWorkspaceMembership[];
  onboarding: {
    hasPendingInvitations: boolean;
    needsWorkspace: boolean;
  };
  pendingInvitations: AtlasWorkspaceInvitation[];
}

/**
 * Normalized operator session payload returned by Atlas server functions.
 */
export interface AtlasSessionPayload {
  accountReady: boolean;
  hasPasskey: boolean;
  isLocal: boolean;
  passkeyCount: number;
  session: {
    id: string;
  };
  user: {
    email: string;
    emailVerified: boolean;
    id: string;
    name: string;
  };
  /**
   * Workspace context for organization-aware UI and onboarding.
   */
  workspace: AtlasWorkspaceState;
}
