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
    const caller = await readFile(
      new URL(
        `../../.github/workflows/deploy-${environment}.yml`,
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(caller, new RegExp(`target: ${environment}`));
    if (environment === "staging")
      assert.match(
        caller,
        /configuration-environment: \$\{\{ inputs\.operation != 'doctor' && 'production' \|\| 'staging' \}\}/,
      );
    assert.match(
      caller,
      /uses: \.\/\.github\/workflows\/cloudflare-publication.yml/,
    );
    const source = await readFile(
      new URL(
        "../../.github/workflows/cloudflare-publication.yml",
        import.meta.url,
      ),
      "utf8",
    );
    const [configuration, steps] = source.split("    steps:\n");
    assert.match(
      configuration,
      /environment: \$\{\{ inputs\.configuration-environment \|\| inputs\.target \}\}/,
    );
    assert.match(steps, /uses: \.\/\.github\/actions\/deploy-atlas-admin/);
    assert.match(steps, /api-url: \$\{\{ vars.ATLAS_PLATFORM_API_URL \}\}/);
    assert.match(
      steps,
      /cloudflare-api-token: \$\{\{ secrets.CLOUDFLARE_ADMIN_DEPLOY_TOKEN \}\}/,
    );
  });
}

test("staging identity proof receives the platform waitlist notification settings", async () => {
  const source = await readFile(
    new URL(
      "../../.github/workflows/cloudflare-publication.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    source,
    /ATLAS_PLATFORM_OPERATOR_EMAILS: \$\{\{ vars\.ATLAS_PLATFORM_OPERATOR_EMAILS \}\}/,
  );
  assert.match(
    source,
    /ATLAS_ADMIN_PUBLIC_URL: \$\{\{ vars\.ATLAS_ADMIN_PUBLIC_URL \}\}/,
  );
});
