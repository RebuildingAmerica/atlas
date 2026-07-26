import { pathToFileURL } from "node:url";
import type { AtlasProduct } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import {
  BRIEFING_ROOM_FIRST_SAVED_VIEWS,
  provisionCustomerWorkspace,
  type CustomerWorkspaceDemoDataSeed,
} from "../src/domains/access/server/demo-workspace-provisioning";

interface ScriptOptions {
  demoDataSeed: CustomerWorkspaceDemoDataSeed;
  firstSavedViews: string[];
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  product: AtlasProduct;
  userEmail: string;
  userId: string;
  userName: string;
}

/**
 * Reads a flag value from argv.
 *
 * @param args - Raw process arguments after the script path.
 * @param flag - Flag name, including the leading dashes.
 */
function argValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

/**
 * Resolves a CLI flag, environment variable, or fallback value.
 *
 * @param args - Raw process arguments after the script path.
 * @param flag - Flag name, including the leading dashes.
 * @param envName - Environment variable name.
 * @param fallback - Fallback value when neither source is set.
 */
function optionValue(args: string[], flag: string, envName: string, fallback: string): string {
  return argValue(args, flag)?.trim() || process.env[envName]?.trim() || fallback;
}

/**
 * Resolves a comma-separated CLI flag, environment variable, or fallback list.
 *
 * @param args - Raw process arguments after the script path.
 * @param flag - Flag name, including the leading dashes.
 * @param envName - Environment variable name.
 * @param fallback - Fallback values when neither source is set.
 */
function optionListValue(
  args: string[],
  flag: string,
  envName: string,
  fallback: readonly string[],
): string[] {
  const rawValue = argValue(args, flag)?.trim() || process.env[envName]?.trim();
  if (!rawValue) {
    return [...fallback];
  }

  const values = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error(`${envName} or ${flag} must include at least one saved view name.`);
  }
  return values;
}

/**
 * Resolves a required CLI flag or environment variable.
 *
 * @param args - Raw process arguments after the script path.
 * @param flag - Flag name, including the leading dashes.
 * @param envName - Environment variable name.
 */
function requiredOptionValue(args: string[], flag: string, envName: string): string {
  const value = argValue(args, flag)?.trim() || process.env[envName]?.trim();
  if (!value) {
    throw new Error(`${envName} or ${flag} is required.`);
  }
  return value;
}

/**
 * Parses an Atlas product identifier supplied to the provisioning script.
 *
 * @param value - Raw product identifier.
 */
function parseProduct(value: string): AtlasProduct {
  switch (value) {
    case "atlas_pro":
    case "atlas_team":
    case "atlas_research_pass":
      return value;
    default:
      throw new Error(`Unsupported Atlas product: ${value}.`);
  }
}

/**
 * Parses the demo data seed mode supplied to the provisioning script.
 *
 * @param value - Raw demo data seed mode.
 */
function parseDemoDataSeed(value: string): CustomerWorkspaceDemoDataSeed {
  switch (value) {
    case "briefing_room":
    case "none":
      return value;
    default:
      throw new Error(`Unsupported demo data seed: ${value}.`);
  }
}

/**
 * Builds the provisioning options from CLI args and environment variables.
 *
 * @param args - Raw process arguments after the script path.
 */
export function parseOptions(args: string[]): ScriptOptions {
  const organizationId = optionValue(args, "--org-id", "ATLAS_DEMO_ORG_ID", "briefing-room-demo");
  const demoDataSeed = parseDemoDataSeed(
    optionValue(args, "--demo-data", "ATLAS_DEMO_DATA", "briefing_room"),
  );
  const firstSavedViews =
    demoDataSeed === "briefing_room"
      ? optionListValue(
          args,
          "--first-saved-views",
          "ATLAS_DEMO_FIRST_SAVED_VIEWS",
          BRIEFING_ROOM_FIRST_SAVED_VIEWS,
        )
      : [];

  return {
    demoDataSeed,
    firstSavedViews,
    organizationId,
    organizationName: optionValue(
      args,
      "--org-name",
      "ATLAS_DEMO_ORG_NAME",
      "Atlas Briefing Room Demo",
    ),
    organizationSlug: optionValue(args, "--org-slug", "ATLAS_DEMO_ORG_SLUG", organizationId),
    product: parseProduct(optionValue(args, "--product", "ATLAS_DEMO_PRODUCT", "atlas_team")),
    userEmail: requiredOptionValue(args, "--email", "ATLAS_DEMO_USER_EMAIL"),
    userId: optionValue(args, "--user-id", "ATLAS_DEMO_USER_ID", "briefing-room-operator"),
    userName: optionValue(args, "--user-name", "ATLAS_DEMO_USER_NAME", "Briefing Room Operator"),
  };
}

/**
 * Runs the staging workspace provisioning command.
 *
 * @param args - Raw process arguments after the script path.
 */
export async function runProvisioningScript(args: string[]): Promise<void> {
  const result = await provisionCustomerWorkspace(parseOptions(args));
  const seed = result.seedCommand ?? "none";
  const savedViews =
    result.firstSavedViews.length > 0 ? result.firstSavedViews.join(" | ") : "none";
  process.stdout.write(
    "Provisioned Atlas Briefing Room workspace: " +
      `org=${result.organizationId} user=${result.userId} product=${result.product} ` +
      `demoSeed=${result.demoDataSeed} firstSavedViews=${savedViews} seedCommand=${seed}\n`,
  );
}

/* v8 ignore start -- entry-point guard: false whenever the module is imported,
   which is the only way a test can reach it. `runProvisioningScript` itself is
   covered directly. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runProvisioningScript(process.argv.slice(2));
}
/* v8 ignore stop */
