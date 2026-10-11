import { describe, expect, it } from "vitest";
import { identifyOperator } from "@/server/operator";
import {
  makeRuntime,
  signedInRequest,
  TEST_OPERATOR,
} from "../helpers/admin-fixtures";

describe("identifying the operator", () => {
  it("names the signed-in operator and keeps the assertion to forward", async () => {
    const { keys, runtime } = await makeRuntime();
    const request = await signedInRequest(keys);

    const result = await identifyOperator(request, runtime);

    expect(result).toEqual({
      ok: true,
      email: TEST_OPERATOR,
      assertion: request.headers.get("Cf-Access-Jwt-Assertion"),
    });
  });

  it("refuses a request Access did not sign", async () => {
    const { runtime } = await makeRuntime();

    const result = await identifyOperator(
      new Request("https://atlas-admin.example.test/"),
      runtime,
    );

    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("refuses someone Access signed in who is not a platform operator", async () => {
    const { keys, runtime } = await makeRuntime();

    const result = await identifyOperator(
      await signedInRequest(keys, {}, "volunteer@example.test"),
      runtime,
    );

    expect(result).toEqual({ ok: false, reason: "not_an_operator" });
  });

  it("acts as the development operator only when one is configured", async () => {
    const { runtime } = await makeRuntime();
    const development = {
      ...runtime,
      env: { ...runtime.env, devOperatorEmail: "dev@example.test" },
    };

    const result = await identifyOperator(
      new Request("http://localhost:3200/"),
      development,
    );

    expect(result).toEqual({
      ok: true,
      email: "dev@example.test",
      assertion: null,
    });
  });
});
