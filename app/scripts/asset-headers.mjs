import { readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const fingerprint =
  /[-.][A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$/;
/** Group verified fingerprint-only directories to stay within Workers' 100-rule limit. */
export function writeAssetHeaders(directory) {
  const routes = [];
  function walk(path) {
    const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const files = entries.filter((entry) => entry.isFile());
    const pathname = "/" + relative(directory, path).split("\\").join("/");
    if (
      path !== directory &&
      files.length &&
      files.every((entry) => fingerprint.test(entry.name))
    )
      routes.push(pathname + "/*");
    else
      for (const file of files)
        if (fingerprint.test(file.name))
          routes.push((pathname === "/" ? "" : pathname) + "/" + file.name);
    for (const entry of entries)
      if (entry.isDirectory()) walk(join(path, entry.name));
  }
  walk(directory);
  if (routes.length > 99)
    throw new Error(
      "Fingerprint cache policy exceeds the 100-rule Workers limit.",
    );
  writeFileSync(
    join(directory, "_headers"),
    [
      "/*",
      "  Cache-Control: public, max-age=300",
      "",
      ...routes.flatMap((route) => [
        route,
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
      ]),
    ].join("\n"),
  );
}
if (
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href &&
  process.env.ATLAS_WEB_RUNTIME
)
  writeAssetHeaders(
    resolve(
      process.env.ATLAS_WEB_RUNTIME === "workers"
        ? ".cloudflare/output/v0/workers/default/assets"
        : ".output/public",
    ),
  );
