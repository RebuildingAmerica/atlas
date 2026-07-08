import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Generator, getConfig } from "@tanstack/router-generator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = getConfig({}, root);
const generator = new Generator({ config, root });

await generator.run();
