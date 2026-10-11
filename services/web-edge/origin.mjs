import { createServer, request as httpRequest } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import { isIP } from "node:net";

/** Guard before Nitro routes, including documentation and API proxy rules. */
export function createOriginServer({ secret, publicUrl, upstreamPort }) {
  const canonical = new URL(publicUrl);
  if (
    !secret ||
    canonical.protocol !== "https:" ||
    canonical.pathname !== "/" ||
    canonical.username ||
    canonical.password ||
    canonical.search ||
    canonical.hash
  )
    throw new Error(
      "A dedicated origin secret and canonical HTTPS origin are required.",
    );
  const digest = (value) => createHash("sha256").update(value).digest();
  const expected = digest(secret);
  return createServer((request, response) => {
    const supplied = request.headers["x-atlas-web-origin-secret"];
    if (
      typeof supplied !== "string" ||
      !timingSafeEqual(expected, digest(supplied))
    ) {
      response.writeHead(403, { "cache-control": "no-store" });
      response.end("Forbidden.");
      return;
    }
    if (request.headers["x-forwarded-host"] !== canonical.host) {
      response.writeHead(421, { "cache-control": "no-store" });
      response.end("Invalid host.");
      return;
    }
    const headers = { ...request.headers };
    for (const key of Object.keys(headers)) {
      if (
        /^(?:cf-|x-forwarded-|x-vercel-)/i.test(key) ||
        [
          "forwarded",
          "x-real-ip",
          "x-atlas-client-ip",
          "x-atlas-proxy-secret",
          "x-atlas-web-origin-secret",
          "x-atlas-web-client-ip",
        ].includes(key)
      )
        delete headers[key];
    }
    headers.host = canonical.host;
    headers["x-forwarded-host"] = canonical.host;
    headers["x-forwarded-proto"] = "https";
    const clientIp = request.headers["x-atlas-web-client-ip"];
    if (typeof clientIp === "string" && isIP(clientIp))
      headers["x-forwarded-for"] = clientIp;
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: upstreamPort,
        path: request.url,
        method: request.method,
        headers,
      },
      (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, {
          ...incoming.headers,
          "cache-control": "private, no-store",
        });
        incoming.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent)
        response.writeHead(502, { "cache-control": "no-store" });
      response.end("Service unavailable.");
    });
    request.on("aborted", () => upstream.destroy());
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  });
}
