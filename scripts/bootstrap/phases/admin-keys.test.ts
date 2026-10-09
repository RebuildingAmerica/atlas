import assert from "node:assert/strict";
import { createPublicKey, verify, sign, createPrivateKey } from "node:crypto";
import { describe, it } from "node:test";
import {
  ADMIN_SIGNING_KEY_SECRET,
  ADMIN_SIGNING_PUBLIC_KEY_VARIABLE,
  generateAdminSigningKeys,
  runAdminKeysPhase,
  type AdminKeysDeps,
  type GhResult,
} from "./admin-keys.js";

interface GhCall {
  args: string[];
  stdin: string | undefined;
}

interface FakeGh {
  calls: GhCall[];
  deps: AdminKeysDeps;
}

const KEYS = { privateKeyPkcs8: "private-pkcs8", publicKeyRaw: "public-raw" };

function fakeGh(
  existingKey: string,
  answers: Partial<
    Record<"secret" | "variable-get" | "variable-set", GhResult>
  > = {},
  confirmAnswer = false,
): FakeGh {
  const calls: GhCall[] = [];
  return {
    calls,
    deps: {
      gh: (args, stdin) => {
        calls.push({ args, stdin });
        if (args[0] === "variable" && args[1] === "get") {
          if (answers["variable-get"]) return answers["variable-get"];
          return existingKey === ""
            ? {
                ok: false,
                output: `variable ${ADMIN_SIGNING_PUBLIC_KEY_VARIABLE} was not found`,
              }
            : { ok: true, output: existingKey };
        }
        if (args[0] === "secret")
          return answers.secret ?? { ok: true, output: "" };
        return answers["variable-set"] ?? { ok: true, output: "" };
      },
      confirm: () => Promise.resolve(confirmAnswer),
      generate: () => KEYS,
    },
  };
}

void describe("admin signing keys", () => {
  void it("generates a pair the admin can sign with and the API can verify", () => {
    const keys = generateAdminSigningKeys();
    const privateKey = createPrivateKey({
      key: Buffer.from(keys.privateKeyPkcs8, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const publicKey = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: Buffer.from(keys.publicKeyRaw, "base64").toString("base64url"),
      },
      format: "jwk",
    });
    const message = Buffer.from("platform admin");

    assert.equal(Buffer.from(keys.publicKeyRaw, "base64").length, 32);
    assert.equal(
      verify(null, message, publicKey, sign(null, message, privateKey)),
      true,
    );
  });

  void it("stores a new key: the private half on stdin, the public half as a variable", async () => {
    const gh = fakeGh("");

    const result = await runAdminKeysPhase(
      "rap/atlas",
      "staging",
      false,
      false,
      gh.deps,
    );

    assert.equal(result.success, true);
    assert.deepEqual(result.followUpItems, []);
    const secretCall = gh.calls.find((call) => call.args[0] === "secret");
    assert.deepEqual(secretCall, {
      args: [
        "secret",
        "set",
        ADMIN_SIGNING_KEY_SECRET,
        "--repo",
        "rap/atlas",
        "--env",
        "staging",
      ],
      stdin: "private-pkcs8",
    });
    assert.equal(
      gh.calls.some((call) => call.args.includes("private-pkcs8")),
      false,
      "the private key must never be a command-line argument",
    );
    assert.deepEqual(gh.calls.at(-1)?.args, [
      "variable",
      "set",
      ADMIN_SIGNING_PUBLIC_KEY_VARIABLE,
      "--body",
      "public-raw",
      "--repo",
      "rap/atlas",
      "--env",
      "staging",
    ]);
  });

  void it("keeps an existing key unless the operator chooses to rotate it", async () => {
    const gh = fakeGh("old-public");

    const result = await runAdminKeysPhase(
      "rap/atlas",
      "production",
      false,
      false,
      gh.deps,
    );

    assert.equal(result.success, true);
    assert.equal(gh.calls.length, 1);
  });

  void it("rotates when asked and says to redeploy the API before the admin", async () => {
    const gh = fakeGh("old-public", {}, true);

    const result = await runAdminKeysPhase(
      "rap/atlas",
      "production",
      false,
      false,
      gh.deps,
    );

    assert.equal(result.success, true);
    assert.match(
      result.followUpItems[0] ?? "",
      /Redeploy the production API, then the production platform admin/,
    );
  });

  void it("rotates without asking under --yes", async () => {
    const gh = fakeGh("old-public");

    const result = await runAdminKeysPhase(
      "rap/atlas",
      "production",
      false,
      true,
      gh.deps,
    );

    assert.equal(result.success, true);
    assert.equal(gh.calls.filter((call) => call.args[1] === "set").length, 2);
  });

  void it("reports whether a key exists in doctor mode, changing nothing", async () => {
    const present = fakeGh("old-public");
    const absent = fakeGh("");

    const ok = await runAdminKeysPhase(
      "rap/atlas",
      "production",
      true,
      false,
      present.deps,
    );
    const missing = await runAdminKeysPhase(
      "rap/atlas",
      "production",
      true,
      false,
      absent.deps,
    );

    assert.equal(ok.success, true);
    assert.equal(missing.success, false);
    assert.match(
      missing.followUpItems[0] ?? "",
      /pnpm bootstrap --admin-keys --target prod/,
    );
    assert.equal(
      [...present.calls, ...absent.calls].every(
        (call) => call.args[1] === "get",
      ),
      true,
    );
  });

  void it("changes nothing when the existing key cannot be read", async () => {
    const gh = fakeGh("", {
      "variable-get": { ok: false, output: "HTTP 401: Bad credentials" },
    });

    const result = await runAdminKeysPhase(
      "rap/atlas",
      "production",
      false,
      true,
      gh.deps,
    );

    assert.equal(result.success, false);
    assert.match(result.followUpItems[0] ?? "", /gh can read/);
    assert.deepEqual(
      gh.calls.map((call) => call.args.slice(0, 2)),
      [["variable", "get"]],
    );
  });

  void it("stops when the private key cannot be stored", async () => {
    const gh = fakeGh("", { secret: { ok: false, output: "HTTP 403" } });

    const result = await runAdminKeysPhase(
      "rap/atlas",
      "staging",
      false,
      false,
      gh.deps,
    );

    assert.equal(result.success, false);
    assert.equal(
      gh.calls.some(
        (call) => call.args[1] === "set" && call.args[0] === "variable",
      ),
      false,
    );
  });

  void it("says the private key was already replaced when the public key cannot be stored", async () => {
    const gh = fakeGh("", {
      "variable-set": { ok: false, output: "HTTP 403" },
    });

    const result = await runAdminKeysPhase(
      "rap/atlas",
      "staging",
      false,
      false,
      gh.deps,
    );

    assert.equal(result.success, false);
    assert.match(
      result.followUpItems[0] ?? "",
      /private key was already replaced/,
    );
  });
});
