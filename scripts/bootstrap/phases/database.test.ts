import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDatabaseSourcePromptMessage,
  formatExistingDatabasePromptMessage,
  formatNeonConnectionStringPromptMessage,
  formatNeonProjectNamePromptMessage,
} from "./database.js";

void describe("database bootstrap prompt guidance", () => {
  void it("explains the database source choice before asking", () => {
    const message = formatDatabaseSourcePromptMessage();

    assert.match(message, /Atlas production needs PostgreSQL/);
    assert.match(message, /Use neonctl/);
    assert.match(message, /runs the schema migration/);
  });

  void it("explains the existing database keep-or-replace decision", () => {
    const message = formatExistingDatabasePromptMessage();

    assert.match(message, /Existing DATABASE_URL found/);
    assert.match(message, /Keep it if this is the Atlas production database/);
    assert.match(message, /Replace it if it points to/);
  });

  void it("walks the user through copying a Neon connection string", () => {
    const message = formatNeonConnectionStringPromptMessage();

    assert.match(message, /Open https:\/\/console\.neon\.tech/);
    assert.match(message, /Copy the pooled PostgreSQL connection string/);
    assert.match(message, /sslmode=require/);
    assert.match(message, /Paste the full connection string here/);
  });

  void it("explains what bootstrap does with a new Neon project name", () => {
    const message = formatNeonProjectNamePromptMessage();

    assert.match(message, /Name the Neon project/);
    assert.match(message, /Use `atlas`/);
    assert.match(message, /read its connection string/);
  });
});
