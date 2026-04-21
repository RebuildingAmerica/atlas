import { cancel, confirm, isCancel } from "@clack/prompts";
import pc from "picocolors";

export function logSubline(message: string): void {
  process.stdout.write(`${pc.gray("│")}  ${message}\n`);
}

export async function promptOrExit<T>(
  promise: Promise<T>,
  cancelMessage = "Bootstrap cancelled.",
): Promise<T> {
  const result = await promise;
  if (isCancel(result)) {
    cancel(cancelMessage);
    process.exit(1);
  }
  return result;
}

export async function promptConfirm(
  message: string,
  initialValue: boolean,
  cancelMessage?: string,
): Promise<boolean> {
  const result = await promptOrExit(
    confirm({ message, initialValue }),
    cancelMessage,
  );
  return result;
}
