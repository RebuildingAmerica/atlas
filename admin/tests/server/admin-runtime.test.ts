import { afterEach, describe, expect, it, vi } from "vitest";
import { adminSource } from "../helpers/admin-fixtures";

describe("admin runtime", () => {
  afterEach(async () => {
    const { env } = await import("../helpers/cloudflare-workers");
    for (const key of Object.keys(env)) Reflect.deleteProperty(env, key);
    vi.doUnmock("@/server/admin-env");
    vi.resetModules();
  });

  it("builds the settings and an Access verifier", async () => {
    const { createAdminRuntime } = await import("@/server/admin-runtime");

    const binding = { getByName: vi.fn() };
    const runtime = createAdminRuntime(
      { ...adminSource(), API_RUNTIME: binding },
      false,
    );

    expect(runtime).not.toBeInstanceOf(Error);
    expect(runtime).toMatchObject({ apiRuntime: binding, development: false });
  });

  it("refuses a hosted runtime without the private API binding", async () => {
    const { createAdminRuntime } = await import("@/server/admin-runtime");
    expect(createAdminRuntime(adminSource(), false)).toEqual(
      new Error("API_RUNTIME binding is required on a deployed admin."),
    );
  });

  it("explicitly uses ordinary API fetch only during local development", async () => {
    const { createAdminRuntime } = await import("@/server/admin-runtime");
    expect(createAdminRuntime(adminSource(), true)).toMatchObject({
      development: true,
    });
  });

  it("keeps the configuration error instead of throwing it", async () => {
    const { createAdminRuntime } = await import("@/server/admin-runtime");

    const runtime = createAdminRuntime(
      adminSource({ ATLAS_API_URL: "" }),
      false,
    );

    expect(runtime).toBeInstanceOf(Error);
    expect((runtime as Error).message).toBe("ATLAS_API_URL is required.");
  });

  it("wraps anything thrown that is not an Error", async () => {
    vi.doMock("@/server/admin-env", () => ({
      readAdminEnv: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the runtime must survive a non-Error throw from a dependency.
        throw "not an error";
      },
    }));
    const { createAdminRuntime } = await import("@/server/admin-runtime");

    expect(createAdminRuntime(adminSource(), false)).toEqual(
      new Error("not an error"),
    );
  });

  it("builds the runtime once per isolate from the Worker's settings", async () => {
    // Imported after the module reset, so this is the copy the runtime reads.
    const { env } = await import("../helpers/cloudflare-workers");
    Object.assign(env, adminSource());
    const { loadAdminRuntime } = await import("@/server/admin-runtime");

    const first = loadAdminRuntime();
    env.ATLAS_API_URL = "";

    expect(first).not.toBeInstanceOf(Error);
    expect(loadAdminRuntime()).toBe(first);
  });
});
