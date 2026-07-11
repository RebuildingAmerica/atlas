import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatVercelSyncPreview,
  requiresProductionConfirmation,
  formatVercelProjectPrompt,
  formatVercelProjectNamePromptMessage,
  formatVercelProductionSyncPromptMessage,
  formatVercelTeamPromptMessage,
  shouldAutoConfirmVercelSync,
  shouldUseDetectedVercelProject,
} from "./vercel.js";

void describe("Vercel env sync preview", () => {
  void it("summarizes project context and groups changes by environment", () => {
    const preview = formatVercelSyncPreview({
      project: {
        projectId: "prj_123",
        scope: "team_123",
        target: "production",
      },
      toAdd: [
        {
          key: "ATLAS_PUBLIC_URL",
          value: "https://atlas.example.test",
          environments: ["production"],
        },
      ],
      toOverwrite: [
        {
          key: "NITRO_PRESET",
          value: "vercel",
          environments: ["production", "preview", "development"],
        },
      ],
    });

    assert.equal(
      preview,
      [
        "Project: prj_123",
        "Team: team_123",
        "Target: production",
        "",
        "No deletions. No secret rotation.",
        "",
        "Production",
        "  add ATLAS_PUBLIC_URL",
        "  update NITRO_PRESET",
        "",
        "Preview",
        "  update NITRO_PRESET",
        "",
        "Development",
        "  update NITRO_PRESET",
      ].join("\n"),
    );
    assert.doesNotMatch(preview, /\s{8,}/);
    assert.doesNotMatch(preview, /\(overwrite\)/);
  });

  void it("requires stronger confirmation for production changes", () => {
    assert.equal(
      requiresProductionConfirmation([
        {
          key: "ATLAS_PUBLIC_URL",
          value: "https://atlas.example.test",
          environments: ["production"],
        },
      ]),
      true,
    );
    assert.equal(
      requiresProductionConfirmation([
        {
          key: "ATLAS_PUBLIC_URL",
          value: "https://atlas-staging.example.test",
          environments: ["preview"],
        },
      ]),
      false,
    );
  });

  void it("only auto-confirms env sync when assume-yes is enabled", () => {
    assert.equal(shouldAutoConfirmVercelSync(true), true);
    assert.equal(shouldAutoConfirmVercelSync(false), false);
    assert.equal(shouldAutoConfirmVercelSync(undefined), false);
  });

  void it("formats Vercel project and team confirmation separately from auth", () => {
    assert.equal(
      formatVercelProjectPrompt({
        source: "linked",
        projectId: "prj_123",
        projectName: "atlas",
        teamId: "team_123",
      }),
      [
        "Use this linked Vercel project?",
        "",
        "Project: atlas",
        "Project ID: prj_123",
        "Team: team_123",
        "",
        "Choose No if this team or project is not the Atlas deployment target.",
      ].join("\n"),
    );
  });

  void it("requires explicit Vercel project confirmation unless assume-yes is enabled", () => {
    assert.equal(
      shouldUseDetectedVercelProject({ assumeYes: false, confirmed: false }),
      false,
    );
    assert.equal(
      shouldUseDetectedVercelProject({ assumeYes: false, confirmed: true }),
      true,
    );
    assert.equal(
      shouldUseDetectedVercelProject({ assumeYes: true, confirmed: false }),
      true,
    );
  });

  void it("guides manual Vercel team and project prompts", () => {
    assert.match(
      formatVercelTeamPromptMessage(),
      /Open https:\/\/vercel\.com\/dashboard/,
    );
    assert.match(formatVercelTeamPromptMessage(), /run `vercel teams ls`/);
    assert.match(
      formatVercelProjectNamePromptMessage(),
      /Copy the project slug/,
    );
    assert.match(formatVercelProjectNamePromptMessage(), /usually `atlas`/);
    assert.match(
      formatVercelProductionSyncPromptMessage(),
      /Confirm the project and team/,
    );
    assert.match(
      formatVercelProductionSyncPromptMessage(),
      /does not delete env vars or rotate secrets/,
    );
  });
});
