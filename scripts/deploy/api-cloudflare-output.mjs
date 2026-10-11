import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  readFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { readBuildOutput } from "@cloudflare/build-output-utils";

/** Produce portable Python artifacts without binding a public route or secrets. */
export async function preparePythonOutput({
  source,
  vendor,
  destination,
  workerName,
  accountId,
  workerEnv,
  durableExport,
  entrypoint = "entry.py",
  packagesAsset = false,
}) {
  for (const [name, binding] of Object.entries(workerEnv ?? {})) {
    if (
      /TOKEN|DATABASE_URL|CLOUDFLARE_|GOOGLE_/i.test(name) ||
      (/SECRET|PASSWORD|PRIVATE_KEY/i.test(name) &&
        binding.type !== "secret") ||
      (binding.type === "secret" && Object.keys(binding).length !== 1)
    )
      throw new Error(
        "Build output must not contain credentials or secret values.",
      );
  }
  if (
    !/^atlas-python-eval(?:-[a-z0-9-]+)?$/.test(workerName) ||
    !/^[a-f0-9]{32}$/.test(accountId)
  )
    throw new Error(
      "An isolated Python evaluation Worker and account are required.",
    );
  const output = join(destination, ".cloudflare/output/v0");
  const worker = join(output, "workers/default");
  const bundle = join(worker, "bundle");
  const modules = {};
  const copy = (directory, prefix, vendored) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (
        packagesAsset &&
        vendored &&
        prefix === "python_modules" &&
        item.name === "packages.zip"
      )
        continue;
      if (lstatSync(path).isSymbolicLink())
        throw new Error("Python artifacts reject symbolic links.");
      if (
        item.name === "__pycache__" ||
        (!vendored && item.name.endsWith(".pyc"))
      )
        continue;
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) copy(path, name, vendored);
      else {
        if (!item.isFile())
          throw new Error("Python artifacts require regular files.");
        if (/^\.env(?:\.|$)/.test(item.name))
          throw new Error("Python artifacts reject secret files.");
        const target = join(bundle, name);
        mkdirSync(join(target, ".."), { recursive: true });
        cpSync(path, target);
        modules[name] = {
          type: vendored
            ? name.endsWith(".js")
              ? "esm"
              : "data"
            : name.endsWith(".py")
              ? "python"
              : "data",
        };
      }
    }
  };
  copy(source, "", false);
  copy(vendor, "python_modules", true);
  if (
    modules[entrypoint]?.type !== "python" ||
    !modules["python_modules/pyvenv.cfg"]
  )
    throw new Error(
      "A Python entrypoint and a complete vendored environment are required.",
    );
  if (packagesAsset) {
    const archive = join(vendor, "packages.zip");
    if (!existsSync(archive))
      throw new Error("The complete API archive is required.");
    const assets = join(worker, "assets");
    mkdirSync(assets, { recursive: true });
    cpSync(archive, join(assets, "packages.zip"));
    writeFileSync(
      join(bundle, "package-identity.json"),
      JSON.stringify({
        sha256: createHash("sha256")
          .update(readFileSync(archive))
          .digest("hex"),
      }),
    );
    modules["package-identity.json"] = { type: "data" };
  }
  const config = {
    name: workerName,
    compatibilityDate: "2026-10-10",
    compatibilityFlags: ["python_workers"],
    workersDev: false,
    previewUrls: false,
    observability: {
      enabled: true,
      headSamplingRate: 1,
      redactQueryString: true,
    },
    env: {
      ...workerEnv,
      ...(packagesAsset ? { PACKAGE_ASSETS: { type: "assets" } } : {}),
    },
    ...(packagesAsset
      ? {
          assets: {
            runWorkerFirst: true,
            notFoundHandling: "none",
            htmlHandling: "none",
          },
        }
      : {}),
    ...(durableExport
      ? {
          exports: {
            [durableExport]: { type: "durable-object", storage: "sqlite" },
          },
        }
      : {}),
    manifest: { type: "complete", mainModule: entrypoint, modules },
  };
  writeFileSync(
    join(output, "config.json"),
    JSON.stringify({
      accountId,
      buildContext: { mode: "production", isPreview: false },
    }),
  );
  writeFileSync(join(worker, "worker.config.json"), JSON.stringify(config));
  return readBuildOutput(destination);
}

/** Dispatch directly to the Python object without spending Python CPU at the edge. */
export async function preparePythonEdgeOutput({
  destination,
  accountId,
  pythonWorkerName,
  discoveryWorkerName,
}) {
  if (
    !/^[a-f0-9]{32}$/.test(accountId ?? "") ||
    pythonWorkerName !== "atlas-python-eval-api" ||
    (discoveryWorkerName !== undefined &&
      discoveryWorkerName !== "atlas-python-eval-discovery")
  )
    throw new Error(
      "The verified Python evaluation account and Worker are required.",
    );
  const output = join(destination, ".cloudflare/output/v0");
  const worker = join(output, "workers/default");
  const bundle = join(worker, "bundle");
  mkdirSync(bundle, { recursive: true });
  cpSync(
    resolve(import.meta.dirname, "../../services/api-cloudflare/edge/index.js"),
    join(bundle, "index.js"),
  );
  writeFileSync(
    join(output, "config.json"),
    JSON.stringify({
      accountId,
      buildContext: { mode: "production", isPreview: false },
    }),
  );
  writeFileSync(
    join(worker, "worker.config.json"),
    JSON.stringify({
      name: "atlas-python-eval-edge",
      compatibilityDate: "2026-10-10",
      workersDev: false,
      previewUrls: false,
      env: {
        API_RUNTIME: {
          type: "durable-object",
          worker: pythonWorkerName,
          exportName: "ApiRuntime",
        },
        ...(discoveryWorkerName
          ? {
              DISCOVERY_RUNTIME: {
                type: "durable-object",
                worker: discoveryWorkerName,
                exportName: "ApiRuntime",
              },
            }
          : {}),
      },
      observability: {
        enabled: true,
        headSamplingRate: 1,
        redactQueryString: true,
      },
      manifest: {
        type: "complete",
        mainModule: "index.js",
        modules: { "index.js": { type: "esm" } },
      },
    }),
  );
  return readBuildOutput(destination);
}
