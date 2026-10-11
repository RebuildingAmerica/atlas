#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, createHmac } from "node:crypto";
const require = createRequire(
  new URL("../../app/package.json", import.meta.url),
);
const { Pool } = require("pg");
const database = new URL(process.env.ATLAS_WEB_LOCAL_POSTGRES_URL);
const origins = (process.env.ATLAS_WEB_LOCAL_ORIGINS ?? "")
  .split(",")
  .map((value) => new URL(value));
if (
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  !origins.length ||
  origins.some((url) => !["localhost", "127.0.0.1"].includes(url.hostname))
)
  throw new Error(
    "This disposable-data probe accepts only loopback databases and origins.",
  );
const pool = new Pool({ connectionString: database.toString() });
const users = [randomUUID(), randomUUID()];
const tokens = [randomUUID(), randomUUID()];
try {
  for (const [i, id] of users.entries()) {
    await pool.query(
      'INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,true)',
      [id, "Local runtime " + i, `${id}@example.invalid`],
    );
    await pool.query(
      'INSERT INTO session (id,token,"userId","expiresAt","updatedAt") VALUES ($1,$2,$3,now()+interval \'1 hour\',now())',
      [randomUUID(), tokens[i], id],
    );
  }
  for (const origin of origins) {
    await Promise.all(
      Array.from({ length: 16 }, async (_, index) => {
        const i = index % 2;
        const token = tokens[i];
        const signature = createHmac(
          "sha256",
          process.env.ATLAS_AUTH_INTERNAL_SECRET,
        )
          .update(token)
          .digest("base64");
        const headers = {
          cookie:
            "__Secure-better-auth.session_token=" +
            encodeURIComponent(token + "." + signature),
        };
        if (process.env.ATLAS_WEB_ORIGIN_SECRET) {
          headers["x-atlas-web-origin-secret"] =
            process.env.ATLAS_WEB_ORIGIN_SECRET;
          headers["x-forwarded-host"] = process.env.ATLAS_WEB_LOCAL_PUBLIC_HOST;
        }
        const response = await fetch(new URL("/api/auth/get-session", origin), {
          headers,
          redirect: "manual",
        });
        assert.equal(response.status, 200);
        const session = await response.json();
        assert.equal(session?.user?.id, users[i]);
      }),
    );
    console.log(
      JSON.stringify({
        event: "local_sessions_isolated",
        origin: origin.origin,
        requests: 16,
        users: 2,
      }),
    );
  }
} finally {
  await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [users]);
  await pool.end();
}
