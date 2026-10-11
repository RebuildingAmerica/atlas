import { createServer, type Server } from "node:http";
import { expect } from "@playwright/test";
import { test as protectedTest } from "../helpers/hosted-test";

interface Servers {
  origin: string;
  external: string;
  seen: { url: string; secret: string | undefined }[];
}
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener.");
  return `http://127.0.0.1:${address.port}`;
}
const test = protectedTest.extend<{ servers: Servers }>({
  servers: async ({ browserName }, provide) => {
    expect(browserName).toBe("chromium");
    const seen: Servers["seen"] = [];
    const externalServer = createServer((request, response) => {
      seen.push({
        url: "external",
        secret: request.headers["cf-access-client-secret"] as string | undefined,
      });
      response.end("External provider");
    });
    const external = await listen(externalServer);
    const server = createServer((request, response) => {
      seen.push({
        url: request.url ?? "",
        secret: request.headers["cf-access-client-secret"] as string | undefined,
      });
      if (request.url === "/start") {
        response.writeHead(302, { location: "/next" });
        response.end();
      } else if (request.url === "/next") {
        response.writeHead(302, { location: external });
        response.end();
      } else response.end("Atlas");
    });
    const origin = await listen(server);
    const saved = [
      process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_ID,
      process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET,
    ];
    process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_ID = "local-test-client";
    process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET = "local-test-secret";
    try {
      await provide({ origin, external, seen });
    } finally {
      if (saved[0] === undefined) delete process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_ID;
      else process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_ID = saved[0];
      if (saved[1] === undefined) delete process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET;
      else process.env.ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET = saved[1];
      await Promise.all(
        [server, externalServer].map(
          (item) =>
            new Promise<void>((resolve, reject) =>
              item.close((error) => {
                if (error) reject(error);
                else resolve();
              }),
            ),
        ),
      );
    }
  },
  baseURL: async ({ servers }, provide) => {
    await provide(servers.origin);
  },
});
test("Access credentials stay on Atlas through same-origin and external redirects", async ({
  page,
  servers,
}) => {
  await page.goto("/start");
  await expect(page).toHaveURL(servers.external + "/");
  expect(servers.seen).toEqual([
    { url: "/start", secret: "local-test-secret" },
    { url: "/next", secret: "local-test-secret" },
    { url: "external", secret: undefined },
  ]);
});
