import { beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import type { AtlasOrganizationDetails } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import type { AtlasSessionPayload } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import type { QueryKey } from "@tanstack/react-query";
import {
  TestButton,
  TestInput,
  TestSelect,
  TestTextarea,
  samlAllowedIssuersFixture,
  teamSeatCostSummaryFixture,
  usageSummaryFixture,
  usageAuditLogFixture,
  integrationMonitoringFixture,
  directoryConfigFixture,
} from "./organization-page-test-bed";
import {
  organizationPageDependencyMocks,
  prepareOrganizationPageTestState,
} from "./organization-page-test-state";

vi.mock("@rebuildingamerica/atlas-ui/ui/button", () => ({
  Button: TestButton,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/input", () => ({
  Input: TestInput,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/select", () => ({
  Select: TestSelect,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/textarea", () => ({
  Textarea: TestTextarea,
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: organizationPageDependencyMocks.useMutation,
  useQuery: organizationPageDependencyMocks.useQuery,
  useQueryClient: organizationPageDependencyMocks.useQueryClient,
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@rebuildingamerica/atlas-ui/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({
    confirm: () => Promise.resolve(true),
  }),
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/toast", () => ({
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["auth", "session"],
  useAtlasSession: organizationPageDependencyMocks.useAtlasSession,
}));

vi.mock("@/domains/access/organizations.functions", () => ({
  acceptWorkspaceInvitation: organizationPageDependencyMocks.acceptWorkspaceInvitation,
  cancelWorkspaceInvitation: organizationPageDependencyMocks.cancelWorkspaceInvitation,
  checkWorkspaceSlugAvailability: () => Promise.resolve({ available: true }),
  convertWorkspaceToTeam: organizationPageDependencyMocks.convertWorkspaceToTeam,
  createWorkspace: organizationPageDependencyMocks.createWorkspace,
  getOrganizationDetails: organizationPageDependencyMocks.getOrganizationDetails,
  inviteWorkspaceMember: organizationPageDependencyMocks.inviteWorkspaceMember,
  leaveWorkspace: organizationPageDependencyMocks.leaveWorkspace,
  rejectWorkspaceInvitation: organizationPageDependencyMocks.rejectWorkspaceInvitation,
  resendWorkspaceInvitation: organizationPageDependencyMocks.resendWorkspaceInvitation,
  removeWorkspaceMember: organizationPageDependencyMocks.removeWorkspaceMember,
  setActiveWorkspace: organizationPageDependencyMocks.setActiveWorkspace,
  updateWorkspaceMemberRole: organizationPageDependencyMocks.updateWorkspaceMemberRole,
  updateWorkspaceProfile: organizationPageDependencyMocks.updateWorkspaceProfile,
}));

vi.mock("@/domains/access/sso.functions", () => ({
  deleteWorkspaceSSOProvider: organizationPageDependencyMocks.deleteWorkspaceSSOProvider,
  getWorkspaceSAMLAllowedIssuers:
    organizationPageDependencyMocks.getWorkspaceSAMLAllowedIssuers ??
    (() => Promise.resolve({ issuerOrigins: ["https://accounts.google.com"] })),
  registerWorkspaceGoogleOIDCProvider:
    organizationPageDependencyMocks.registerWorkspaceGoogleOIDCProvider,
  registerWorkspaceSAMLProvider: organizationPageDependencyMocks.registerWorkspaceSAMLProvider,
  requestWorkspaceSSODomainVerification:
    organizationPageDependencyMocks.requestWorkspaceSSODomainVerification,
  rotateWorkspaceSAMLCertificate:
    organizationPageDependencyMocks.rotateWorkspaceSAMLCertificate ?? vi.fn(),
  setWorkspacePrimarySSOProvider: organizationPageDependencyMocks.setWorkspacePrimarySSOProvider,
  verifyWorkspaceSSODomain: organizationPageDependencyMocks.verifyWorkspaceSSODomain,
}));

let atlasSession: AtlasSessionPayload;
let organizationDetails: AtlasOrganizationDetails | null;
let organizationLoading: boolean;
let refetchSession: ReturnType<typeof vi.fn>;

const organizationQueryKey = ["auth", "organization"] as const;
const samlAllowedIssuersQueryKey = ["auth", "saml-allowed-issuers"] as const;
const teamSeatCostSummaryQueryKey = ["auth", "team-seat-cost-summary"] as const;
const workspaceDirectoryConfigQueryKey = ["workspace", "directory-config"] as const;
const workspaceIntegrationMonitoringQueryKey = ["workspace", "integration-monitoring"] as const;
const workspaceUsageAuditLogQueryKey = ["workspace", "usage-audit-log"] as const;
const workspaceUsageSummaryQueryKey = ["workspace", "usage-summary"] as const;

interface OrganizationPageQueryOptions {
  enabled?: boolean;
  initialData?: unknown;
  queryKey?: QueryKey;
}

interface OrganizationPageQueryResult {
  data: unknown;
  isLoading: boolean;
}

/**
 * Checks whether a React Query key starts with a known workspace query prefix.
 *
 * @param queryKey - Query key supplied to the mocked hook.
 * @param prefix - Stable prefix exported by the organization-page data hook.
 */
function queryKeyStartsWith(queryKey: QueryKey | undefined, prefix: QueryKey): boolean {
  if (!queryKey || queryKey.length < prefix.length) {
    return false;
  }

  return prefix.every((segment, index) => queryKey[index] === segment);
}

/**
 * Resolves page data by React Query key so independent queries receive the
 * same shapes they receive in production.
 *
 * @param queryKey - Query key supplied to the mocked hook.
 * @param initialData - Server-provided initial data from the component.
 */
function resolveOrganizationPageQueryData(
  queryKey: QueryKey | undefined,
  initialData: unknown,
): unknown {
  if (queryKeyStartsWith(queryKey, organizationQueryKey)) {
    return initialData ?? organizationDetails;
  }
  if (queryKeyStartsWith(queryKey, samlAllowedIssuersQueryKey)) {
    return samlAllowedIssuersFixture;
  }
  if (queryKeyStartsWith(queryKey, teamSeatCostSummaryQueryKey)) {
    return teamSeatCostSummaryFixture;
  }
  if (queryKeyStartsWith(queryKey, workspaceUsageSummaryQueryKey)) {
    return usageSummaryFixture;
  }
  if (queryKeyStartsWith(queryKey, workspaceUsageAuditLogQueryKey)) {
    return usageAuditLogFixture;
  }
  if (queryKeyStartsWith(queryKey, workspaceIntegrationMonitoringQueryKey)) {
    return integrationMonitoringFixture;
  }
  if (queryKeyStartsWith(queryKey, workspaceDirectoryConfigQueryKey)) {
    return directoryConfigFixture;
  }

  return undefined;
}

/**
 * Builds the page-level query stub used by organization page tests.
 */
function createOrganizationPageQueryStub() {
  return (options: OrganizationPageQueryOptions): OrganizationPageQueryResult => {
    if (!options.enabled) {
      return {
        data: undefined,
        isLoading: false,
      };
    }

    return {
      data: resolveOrganizationPageQueryData(options.queryKey, options.initialData),
      isLoading: queryKeyStartsWith(options.queryKey, organizationQueryKey)
        ? organizationLoading
        : false,
    };
  };
}

/**
 * Updates the mocked session hook with the supplied session fixture.
 *
 * @param session - The normalized Atlas session exposed to the page.
 */
export function setAtlasSession(session: AtlasSessionPayload): void {
  atlasSession = session;
  refetchSession.mockResolvedValue({
    data: atlasSession,
  });

  organizationPageDependencyMocks.useAtlasSession.mockReturnValue({
    data: atlasSession,
    refetch: refetchSession,
  });
}

/**
 * Updates the mocked organization query with the supplied organization
 * fixture.
 *
 * @param details - The organization details visible to the page.
 * @param isLoading - Whether the organization query should report loading.
 */
export function setOrganizationDetails(
  details: AtlasOrganizationDetails | null,
  isLoading = false,
): void {
  organizationDetails = details;
  organizationLoading = isLoading;
  organizationPageDependencyMocks.useQuery.mockImplementation(createOrganizationPageQueryStub());
}

/**
 * Loads and renders the workspace-management page under test.
 *
 * @param props - Optional initial organization data for the page.
 */
export async function renderOrganizationPage(
  props: { initialOrganization?: AtlasOrganizationDetails | null } = {},
) {
  const organizationPageModule = await import("@/domains/access/pages/workspace/organization-page");
  const { OrganizationPage } = organizationPageModule;

  return render(<OrganizationPage {...props} />);
}

/**
 * Loads and renders the focused enterprise SSO page under test.
 *
 * @param props - Optional initial organization data for the page.
 */
export async function renderOrganizationSSOPage(
  props: { initialOrganization?: AtlasOrganizationDetails | null } = {},
) {
  const organizationSSOPageModule =
    await import("@/domains/access/pages/workspace/organization-sso-page");
  const { OrganizationSSOPage } = organizationSSOPageModule;

  return render(<OrganizationSSOPage {...props} />);
}

beforeEach(() => {
  vi.resetModules();

  refetchSession = vi.fn();
  const { session, organization } = prepareOrganizationPageTestState();
  setAtlasSession(session);
  setOrganizationDetails(organization);
});
