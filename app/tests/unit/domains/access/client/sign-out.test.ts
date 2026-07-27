// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signOutWithRedirect } from "@/domains/access/client/sign-out";

const mocks = vi.hoisted(() => ({
  getAuthClient: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/domains/access/client/auth-client", () => ({
  getAuthClient: mocks.getAuthClient,
}));

describe("signOutWithRedirect", () => {
  beforeEach(() => {
    mocks.getAuthClient.mockReturnValue({ signOut: mocks.signOut });
  });

  it("sends the operator to the requested page once the session is gone", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    mocks.signOut.mockResolvedValue({});

    await signOutWithRedirect({ redirectTo: "/sign-in" });

    expect(assign).toHaveBeenCalledWith("/sign-in");
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("leaves the page as soon as Better Auth reports success, and only once", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    mocks.signOut.mockImplementation((options: { fetchOptions: { onSuccess: () => void } }) => {
      options.fetchOptions.onSuccess();
      return Promise.resolve({});
    });

    await signOutWithRedirect({ redirectTo: "/" });

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("reports a sign-out that never got far enough to redirect", async () => {
    const assign = vi.fn();
    const onError = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    mocks.signOut.mockRejectedValue(new Error("offline"));

    await signOutWithRedirect({ onError, redirectTo: "/sign-in" });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("stays quiet when the redirect already happened before the failure", async () => {
    const assign = vi.fn();
    const onError = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    mocks.signOut.mockImplementation((options: { fetchOptions: { onSuccess: () => void } }) => {
      options.fetchOptions.onSuccess();
      return Promise.reject(new Error("connection closed after redirect"));
    });

    await signOutWithRedirect({ onError, redirectTo: "/sign-in" });

    expect(assign).toHaveBeenCalledWith("/sign-in");
    expect(onError).not.toHaveBeenCalled();
  });

  it("swallows a failure the caller did not ask to hear about", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    mocks.signOut.mockRejectedValue(new Error("offline"));

    await expect(signOutWithRedirect({ redirectTo: "/sign-in" })).resolves.toBeUndefined();
    expect(assign).not.toHaveBeenCalled();
  });
});
