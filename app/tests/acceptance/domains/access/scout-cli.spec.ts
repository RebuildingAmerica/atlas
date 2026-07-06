import { expect, test } from "@playwright/test";
import { performSignIn, requireEnv } from "../../helpers/auth";
import {
  approveScoutLogin,
  createScoutHome,
  exchangeScoutApiToken,
  findQueuedJob,
  getJob,
  getRun,
  queueDirectUrlJob,
  startScoutWorker,
  startFixtureOllamaServer,
  startSeedPageServer,
  stopScoutWorker,
} from "../../helpers/scout-cli";

const appUrl = requireEnv("ATLAS_E2E_APP_URL");
const apiUrl = requireEnv("ATLAS_E2E_API_URL");

test.describe.configure({ mode: "serial" });

test("Scout installed CLI e2e: login, device, direct job, worker sync, complete", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "Magic-link account setup uses virtual WebAuthn.");
  test.setTimeout(120_000);

  const ollama = await startFixtureOllamaServer();
  const seedPage = await startSeedPageServer();
  const scoutHome = await createScoutHome(ollama.url);

  try {
    await performSignIn(page, { createWorkspace: true });
    await page.goto("/account", { waitUntil: "networkidle" });

    const session = await approveScoutLogin(page, scoutHome, appUrl);
    await page.goto("/account", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Scout devices" })).toBeVisible();
    await expect(page.getByText(session.worker_name ?? session.worker_id)).toBeVisible();
    await expect(page.getByText("Public uploads")).toBeVisible();
    await expect(page.getByText("Search key needed")).toBeVisible();

    const apiToken = await exchangeScoutApiToken(appUrl, session);
    const run = await queueDirectUrlJob(apiUrl, apiToken.token, seedPage.url);
    const queuedJob = await findQueuedJob(apiUrl, apiToken.token, run.id);
    expect(queuedJob.status).toBe("queued");

    const workerStart = await startScoutWorker(scoutHome, appUrl);
    expect(workerStart.exitCode, workerStart.output).toBe(0);
    try {
      await expect
        .poll(async () => (await getJob(apiUrl, apiToken.token, queuedJob.id)).status, {
          intervals: [500, 1_000, 2_000],
          timeout: 90_000,
        })
        .toBe("completed");

      const completedJob = await getJob(apiUrl, apiToken.token, queuedJob.id);
      expect(completedJob.completed_at).not.toBeNull();
      expect(["claimed", "running"]).toContain(completedJob.progress?.step);

      const completedRun = await getRun(apiUrl, apiToken.token, run.id);
      expect(completedRun.status).toBe("completed");
      expect(completedRun.entries_confirmed).toBeGreaterThan(0);
      expect(completedRun.research_summary?.ranked_leads[0]?.name).toBe(
        "Tenant Defense Collective",
      );
    } finally {
      const workerStop = await stopScoutWorker(scoutHome);
      expect(workerStop.exitCode, workerStop.output).toBe(0);
    }
  } finally {
    await scoutHome.cleanup();
    await seedPage.close();
    await ollama.close();
  }
});
