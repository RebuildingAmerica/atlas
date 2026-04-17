import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import server from "./dist/server/server.js";

const port = Number.parseInt(process.env.PORT || "3000", 10);
const clientDistDir = path.resolve("./dist/client");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".woff2": "font/woff2",
};

function getConfiguredApiProxyTarget() {
  const configuredTarget = process.env.ATLAS_SERVER_API_PROXY_TARGET?.trim();
  if (!configuredTarget) {
    return null;
  }

  return new URL(configuredTarget).toString();
}

function shouldProxyRequest(url) {
  return /^\/api(\/|$)/.test(url.pathname) && !/^\/api\/auth(\/|$)/.test(url.pathname);
}

function buildProxyRequestInit(req) {
  const headers = new Headers();

  Object.entries(req.headers).forEach(([key, value]) => {
    if (key.toLowerCase() === "host" || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
      return;
    }

    headers.set(key, value);
  });

  const init = {
    headers,
    method: req.method,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req;
    init.duplex = "half";
  }

  return init;
}

function resolveStaticAssetPath(urlPath) {
  const normalizedPath = urlPath === "/" ? "/index.html" : urlPath;
  const assetPath = path.resolve(clientDistDir, `.${normalizedPath}`);

  if (!assetPath.startsWith(clientDistDir)) {
    return null;
  }

  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    return null;
  }

  return assetPath;
}

function writeStaticAsset(res, assetPath, method) {
  const extension = path.extname(assetPath);
  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";

  res.statusCode = 200;
  res.setHeader("content-type", contentType);

  if (method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(assetPath).pipe(res);
}

async function writeNodeResponse(res, response) {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(res);
}

const listener = http.createServer(async (req, res) => {
  try {
    const apiProxyTarget = getConfiguredApiProxyTarget();
    const protocol = req.socket.encrypted ? "https" : "http";
    const host = req.headers.host || `localhost:${port}`;
    const url = new URL(req.url || "/", `${protocol}://${host}`);
    const init = buildProxyRequestInit(req);
    const staticAssetPath = resolveStaticAssetPath(url.pathname);

    if (staticAssetPath && (req.method === "GET" || req.method === "HEAD")) {
      writeStaticAsset(res, staticAssetPath, req.method);
      return;
    }

    // CORS for auth routes — MCP clients need cross-origin access to OAuth endpoints
    if (/^\/api\/auth(\/|$)/.test(url.pathname)) {
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Max-Age", "86400");
      }
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }
    }

    if (shouldProxyRequest(url)) {
      if (!apiProxyTarget) {
        res.statusCode = 502;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("Atlas API proxy target is not configured.");
        return;
      }

      const proxyUrl = new URL(`${url.pathname}${url.search}`, `${apiProxyTarget.replace(/\/+$/, "")}/`);
      const response = await fetch(proxyUrl, init);
      await writeNodeResponse(res, response);
      return;
    }

    const response = await server.fetch(new Request(url, init));
    await writeNodeResponse(res, response);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
    }
    res.end("Internal Server Error");
  }
});

listener.listen(port, "0.0.0.0", () => {
  console.log(`Atlas web listening on http://0.0.0.0:${port}`);
});
