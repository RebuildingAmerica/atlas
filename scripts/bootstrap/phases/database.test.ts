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
    const message = formatDatabaseSourcePromptMessage("production");

    assert.match(message, /Atlas production needs its own PostgreSQL/);
    assert.match(message, /Use neonctl/);
    assert.match(message, /runs the schema migration/);
  });

  void it("explains the existing database keep-or-replace decision", () => {
    const message = formatExistingDatabasePromptMessage("production");

    assert.match(message, /Existing DATABASE_URL found/);
    assert.match(message, /already in \.env\.production/);
    assert.match(message, /Keep it if this is the Atlas production database/);
    assert.match(
      message,
      /Replace it if it actually points to the staging database/,
    );
  });

  void it("warns staging not to reuse the production connection", () => {
    const message = formatExistingDatabasePromptMessage("staging");

    assert.match(message, /already in \.env\.staging/);
    assert.match(message, /Keep it if this is the Atlas staging database/);
    assert.match(
      message,
      /Replace it if it actually points to the production database/,
    );
  });

  void it("walks the user through copying a Neon connection string", () => {
    const message = formatNeonConnectionStringPromptMessage("production");

    assert.match(message, /Open https:\/\/console\.neon\.tech/);
    assert.match(message, /Atlas production project database/);
    assert.match(message, /Copy the pooled PostgreSQL connection string/);
    assert.match(message, /sslmode=require/);
    assert.match(message, /writes it to \.env\.production/);
  });

  void it("explains what bootstrap does with a new Neon project name", () => {
    const message = formatNeonProjectNamePromptMessage("production");

    assert.match(message, /Name the Neon project/);
    assert.match(message, /Use `atlas`/);
    assert.match(message, /Do not reuse the staging project/);
    assert.match(message, /read its connection string/);
  });

  void it("suggests a distinct project name and warning for staging", () => {
    const message = formatNeonProjectNamePromptMessage("staging");

    assert.match(message, /Use `atlas-staging`/);
    assert.match(message, /Do not reuse the production project/);
  });
});
