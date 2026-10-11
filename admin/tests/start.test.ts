import { describe, expect, it, vi } from "vitest";
import { runServerMiddleware } from "./helpers/middleware";

const gate = vi.hoisted(() => ({
  applyPageHeaders: vi.fn(),
  gateRequest: vi.fn(),
  loadAdminRuntime: vi.fn(() => new Error("not configured")),
  request: new Request("https://atlas-admin.example.test/"),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => gate.request,
}));
vi.mock("@/server/gate", () => ({
  applyPageHeaders: gate.applyPageHeaders,
  gateRequest: gate.gateRequest,
}));
vi.mock("@/server/admin-runtime", () => ({
  loadAdminRuntime: gate.loadAdminRuntime,
}));

describe("the admin's request middleware", () => {
  it("returns the gate's refusal without running the request", async () => {
    const { accessGate } = await import("@/start");
    const refusal = new Response("refused", { status: 403 });
    gate.gateRequest.mockResolvedValue(refusal);
    const next = vi.fn();

    expect(await runServerMiddleware(accessGate, next)).toBe(refusal);
    expect(next).not.toHaveBeenCalled();
    expect(gate.gateRequest).toHaveBeenCalledWith(
      gate.request,
      gate.loadAdminRuntime.mock.results[0]?.value,
    );
  });

  it("runs an admitted request and marks its page private", async () => {
    const { accessGate } = await import("@/start");
    gate.gateRequest.mockResolvedValue(null);
    const result = { response: new Response("ok") };

    expect(
      await runServerMiddleware(accessGate, () => Promise.resolve(result)),
    ).toBe(result);
    expect(gate.applyPageHeaders).toHaveBeenCalledWith(result.response.headers);
  });

  it("checks CSRF on server functions only, after the gate", async () => {
    const { accessGate, isServerFunctionRequest, startInstance } =
      await import("@/start");

    expect(isServerFunctionRequest({ handlerType: "serverFn" })).toBe(true);
    expect(isServerFunctionRequest({ handlerType: "router" })).toBe(false);
    const options = await startInstance.getOptions();
    expect(options.requestMiddleware?.[0]).toBe(accessGate);
    expect(options.requestMiddleware).toHaveLength(2);
  });
});
