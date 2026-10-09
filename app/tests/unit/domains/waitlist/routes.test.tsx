// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-router", async () =>
  (await import("../../../helpers/router-harness")).installRouterMocks(),
);
vi.mock("@/domains/waitlist/pages/waitlist-page", () => ({
  WaitlistPage: ({ product, interval }: { product?: string; interval?: string }) => (
    <div>
      {product} {interval}
    </div>
  ),
}));
vi.mock("@/domains/waitlist/pages/waitlist-link-page", () => ({
  WaitlistLinkPage: ({ token, kind }: { token: string; kind: string }) => (
    <div>
      {token} {kind}
    </div>
  ),
  WaitlistRequestPage: ({ id }: { id: string }) => <div>{id}</div>,
}));
vi.mock("@/domains/waitlist/pages/waitlist-admin-page", () => ({
  WaitlistAdminPage: () => <div>Staff queue</div>,
}));
vi.mock("@/domains/access/server", () => ({ redirectIfLocalSession: vi.fn() }));
vi.mock("@/domains/waitlist/waitlist.functions", () => ({
  loadWaitlistStaffAccess: vi.fn(() => Promise.resolve({ allowed: true })),
}));
describe("waitlist route contracts", () => {
  beforeEach(async () => {
    (await import("../../../helpers/router-harness")).resetRouterMocks();
  });
  it("keeps private pages unindexed, uncached and without a referrer", async () => {
    const { asRouteStub } = await import("../../../helpers/router-harness");
    const modules = await Promise.all([
      import("@/routes/_onboarding/waitlist/index"),
      import("@/routes/_onboarding/waitlist/link"),
      import("@/routes/_onboarding/waitlist/request/$id"),
      import("@/routes/_workspace/admin/waitlist"),
    ]);
    for (const module of modules) {
      const route = asRouteStub(module.Route);
      const head = route.options.head?.({}) as { meta: Record<string, string>[] };
      expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
      expect(
        (
          route.options as typeof route.options & { headers: () => Record<string, string> }
        ).headers(),
      ).toEqual({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    }
  });
  function required<T>(value: T | undefined): T {
    if (value === undefined) throw new Error("Expected route component");
    return value;
  }
  it("passes selected products, scoped links and private request ids into screens", async () => {
    const { asRouteStub, readRouterMocks } = await import("../../../helpers/router-harness");
    const signup = asRouteStub((await import("@/routes/_onboarding/waitlist/index")).Route);
    readRouterMocks().useSearch.mockReturnValue({ product: "atlas_team", interval: "yearly" });
    await signup.options.beforeLoad?.({});
    const Signup = required(signup.options.component);
    const first = render(<Signup />);
    expect(screen.getByText("atlas_team yearly")).toBeInTheDocument();
    first.unmount();
    const link = asRouteStub((await import("@/routes/_onboarding/waitlist/link")).Route);
    readRouterMocks().useSearch.mockReturnValue({ token: "private-token", kind: "invite" });
    const Link = required(link.options.component);
    const second = render(<Link />);
    expect(screen.getByText("private-token invite")).toBeInTheDocument();
    second.unmount();
    const request = asRouteStub((await import("@/routes/_onboarding/waitlist/request/$id")).Route);
    readRouterMocks().useParams.mockReturnValue({ id: "private-id" });
    const Request = required(request.options.component);
    render(<Request />);
    expect(screen.getByText("private-id")).toBeInTheDocument();
    const admin = asRouteStub((await import("@/routes/_workspace/admin/waitlist")).Route);
    await admin.options.beforeLoad?.({});
    const { loadWaitlistStaffAccess } = await import("@/domains/waitlist/waitlist.functions");
    expect(loadWaitlistStaffAccess).toHaveBeenCalled();
  });
});
