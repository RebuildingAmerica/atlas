import { vi } from "vitest";

/**
 * Shared dependency mocks for the organization page unit tests.
 */
export const organizationPageDependencyMocks = {
  acceptWorkspaceInvitation: vi.fn(),
  cancelWorkspaceInvitation: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspaceSSOProvider: vi.fn(),
  getOrganizationDetails: vi.fn(),
  invalidateQueries: vi.fn(),
  inviteWorkspaceMember: vi.fn(),
  getWorkspaceSAMLAllowedIssuers: vi.fn(),
  registerWorkspaceGoogleOIDCProvider: vi.fn(),
  registerWorkspaceSAMLProvider: vi.fn(),
  rejectWorkspaceInvitation: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  requestWorkspaceSSODomainVerification: vi.fn(),
  rotateWorkspaceSAMLCertificate: vi.fn(),
  setActiveWorkspace: vi.fn(),
  setWorkspacePrimarySSOProvider: vi.fn(),
  updateWorkspaceMemberRole: vi.fn(),
  updateWorkspaceProfile: vi.fn(),
  useAtlasSession: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  verifyWorkspaceSSODomain: vi.fn(),
  leaveWorkspace: vi.fn(),
} as const;
