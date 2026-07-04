import { expect } from "vitest";
import { asRouteStub } from "./router-harness";

export interface TextRouteResponse {
  body: string;
  response: Response;
}

export async function readTextRouteResponse(route: unknown): Promise<TextRouteResponse> {
  const Route = asRouteStub(route);
  const handlers = Route.options.server?.handlers;
  if (!handlers?.GET) throw new Error("Expected GET handler");
  const response = (await handlers.GET({})) as Response;

  expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  return {
    body: await response.text(),
    response,
  };
}
