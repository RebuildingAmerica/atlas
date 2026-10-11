import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deployed platform admin can manage the paid waitlist", async () => {
  const source = await readFile(
    new URL(
      "../../.github/actions/deploy-atlas-api/action.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /"platform.waitlist.read"/);
  assert.match(source, /"platform.waitlist.write"/);
});

for (const environment of ["production", "staging"]) {
  test(`${environment} admin deployment reads environment configuration inside the job`, async () => {
    const source = await readFile(
      new URL(
        `../../.github/workflows/deploy-${environment}.yml`,
        import.meta.url,
      ),
      "utf8",
    );
    const job = source
      .split("  deploy-admin:\n")[1]
      .split(/\n  [a-z][\w-]*:/)[0];
    const [configuration, steps] = job.split("    steps:\n");
    assert.match(configuration, new RegExp(`environment: ${environment}`));
    assert.doesNotMatch(configuration, /vars\.ATLAS_ADMIN_PUBLIC_URL/);
    assert.match(steps, /if: vars\.ATLAS_ADMIN_PUBLIC_URL != ''/);
    assert.match(steps, /uses: \.\/\.github\/actions\/deploy-atlas-admin/);
  });
}

test("staging identity proof receives the platform waitlist notification settings", async () => {
  const source = await readFile(
    new URL("../../.github/workflows/deploy-staging.yml", import.meta.url),
    "utf8",
  );
  const environment = source
    .split("- name: Start branch app for hosted identity verification")[1]
    .split("        run:")[0];
  assert.match(
    environment,
    /ATLAS_PLATFORM_OPERATOR_EMAILS: \$\{\{ vars\.ATLAS_PLATFORM_OPERATOR_EMAILS \}\}/,
  );
  assert.match(
    environment,
    /ATLAS_ADMIN_PUBLIC_URL: \$\{\{ vars\.ATLAS_ADMIN_PUBLIC_URL \}\}/,
  );
});
