import { readFileSync } from "node:fs";

interface TurboTask {
  env?: string[];
}

interface TurboConfig {
  tasks: Record<string, TurboTask | undefined>;
}

export function loadTurboConfig(): TurboConfig {
  return JSON.parse(
    readFileSync(new URL("../../turbo.json", import.meta.url), "utf8"),
  ) as TurboConfig;
}

export function loadRootTurboConfig(): TurboConfig {
  return JSON.parse(
    readFileSync(new URL("../../../turbo.json", import.meta.url), "utf8"),
  ) as TurboConfig;
}

export function envForTask(config: TurboConfig, taskName: string): string[] {
  const task = config.tasks[taskName];
  if (!task) {
    throw new Error(`Expected Turbo task ${taskName}`);
  }

  return task.env ?? [];
}
