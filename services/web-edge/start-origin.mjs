import { spawn } from "node:child_process";
import { createOriginServer } from "./origin.mjs";
import { createConnection } from "node:net";

const upstreamPort = 3001;
const server = createOriginServer({
  secret: process.env.ATLAS_WEB_ORIGIN_SECRET,
  publicUrl: process.env.ATLAS_PUBLIC_URL,
  upstreamPort,
});
// Only the guarded listener is externally reachable. Platform TCP startup
// probes need no public health exception that could bypass the origin guard.
const child = spawn(process.execPath, [".output/server/index.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(upstreamPort),
    HOST: "127.0.0.1",
    NITRO_PORT: String(upstreamPort),
    NITRO_HOST: "127.0.0.1",
  },
});
child.on("exit", (code) => {
  server.close();
  process.exit(code ?? 1);
});
child.on("error", () => {
  console.error("Atlas application failed to start.");
  process.exit(1);
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close();
    child.kill(signal);
  });
const deadline = Date.now() + 60_000;
while (true) {
  try {
    await new Promise((resolve, reject) => {
      const connection = createConnection({
        port: upstreamPort,
        host: "127.0.0.1",
      });
      connection.once("connect", () => {
        connection.destroy();
        resolve();
      });
      connection.once("error", reject);
    });
    break;
  } catch {
    if (Date.now() >= deadline) {
      child.kill();
      throw new Error("Atlas application startup timed out.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
server.requestTimeout = 180_000;
server.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
