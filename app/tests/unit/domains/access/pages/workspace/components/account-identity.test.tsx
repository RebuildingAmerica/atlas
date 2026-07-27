// @vitest-environment jsdom

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AtprotoIdentityResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas-schemas";
import type * as AtprotoIdentitiesModule from "@/domains/access/atproto-identities";
import type * as ReactQueryModule from "@tanstack/react-query";
import { AccountIdentitySection } from "@/domains/access/pages/workspace/components/account/identity";
import { renderWithProviders } from "../../../../../../helpers/render-with-providers";
import { stubFetch } from "../../../../../../helpers/stub-fetch";
import { createAccountIdentity } from "../../../components/organization/atproto-identity-section-test-support";

const mocks = vi.hoisted(() => ({
  provisionManagedIdentity: vi.fn<(handle: string) => Promise<AtprotoIdentityResponse>>(),
}));

vi.mock("@/domains/access/atproto-identities", async () => {
  const actual = await vi.importActual<typeof AtprotoIdentitiesModule>(
    "@/domains/access/atproto-identities",
  );
  const { useMutation, useQueryClient } =
    await vi.importActual<typeof ReactQueryModule>("@tanstack/react-query");

  return {
    ...actual,
    useProvisionManagedAtprotoIdentity: () => {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: (handle: string) => mocks.provisionManagedIdentity(handle),
        onSettled: async () => {
          await queryClient.invalidateQueries({ queryKey: actual.atprotoIdentitiesQueryKey });
        },
      });
    },
  };
});

describe("AccountIdentitySection", () => {
  beforeEach(() => {
    mocks.provisionManagedIdentity.mockResolvedValue(
      createAccountIdentity({ current_handle: "person.atlas.test", id: "identity-managed" }),
    );
  });

  it("creates an Atlas-managed identity and shows it on the account", async () => {
    let identities: ReturnType<typeof createAccountIdentity>[] = [];
    stubFetch(() => ({ body: identities }));
    mocks.provisionManagedIdentity.mockImplementation((handle: string) => {
      const created = createAccountIdentity({ current_handle: handle, id: "identity-managed" });
      identities = [created];
      return Promise.resolve(created);
    });

    renderWithProviders(<AccountIdentitySection />);

    expect(await screen.findByText("No ATProto accounts connected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Atlas identity" })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "New Atlas handle" }), {
      target: { value: "person.atlas.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Atlas identity" }));

    expect(await screen.findByText("person.atlas.test")).toBeInTheDocument();
    expect(mocks.provisionManagedIdentity).toHaveBeenCalledWith("person.atlas.test");
  });

  it("explains a handle the Atlas PDS will not take", async () => {
    stubFetch({ body: [] });
    mocks.provisionManagedIdentity.mockRejectedValue(new Error("handle taken"));

    renderWithProviders(<AccountIdentitySection />);

    fireEvent.change(screen.getByRole("textbox", { name: "New Atlas handle" }), {
      target: { value: "taken.atlas.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Atlas identity" }));

    expect(
      await screen.findByText("Atlas could not create that identity. Try a different handle."),
    ).toBeInTheDocument();
  });

  it("says so when the connected accounts cannot be read", async () => {
    stubFetch({ body: { detail: "boom" }, status: 500 });

    renderWithProviders(<AccountIdentitySection />);

    expect(await screen.findByText("Could not load ATProto accounts.")).toBeInTheDocument();
    expect(screen.queryByText("No ATProto accounts connected.")).toBeNull();
  });

  it("warns about the profiles a disconnect would leave behind", async () => {
    const api = stubFetch(() => ({
      body: [
        createAccountIdentity({
          profiles: [{ id: "profile_1", name: "Person Example", slug: "person", type: "person" }],
        }),
      ],
    }));

    renderWithProviders(<AccountIdentitySection />);

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    expect(await screen.findByText(/Affected profiles: Person Example\./)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(
        api.requests.some(
          (request) =>
            request.init?.method === "DELETE" &&
            request.url.endsWith("/api/atproto/identities/identity-existing"),
        ),
      ).toBe(true);
    });
  });

  it("keeps the identity connected when the operator backs out of the confirmation", async () => {
    const api = stubFetch(() => ({ body: [createAccountIdentity()] }));

    renderWithProviders(<AccountIdentitySection />);

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    expect(await screen.findByText(/Its public identity remains until/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(api.requests.some((request) => request.init?.method === "DELETE")).toBe(false);
    expect(screen.getByText("existing.example")).toBeInTheDocument();
  });

  it("disconnects an identity no profile depends on without naming any", async () => {
    stubFetch(() => ({ body: [createAccountIdentity()] }));

    renderWithProviders(<AccountIdentitySection />);

    expect(await screen.findByText("No profiles use this identity.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(await screen.findByText(/Its public identity remains until/)).toBeInTheDocument();
    expect(screen.queryByText(/Affected profiles:/)).toBeNull();
  });
});
