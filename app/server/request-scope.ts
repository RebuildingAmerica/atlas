import { AsyncLocalStorage } from "node:async_hooks";
import type { ServerApiTransport } from "@rebuildingamerica/atlas-api-client/orval/fetcher";

interface WorkerRequest {
  apiTransport?: ServerApiTransport;
  connectionString: string;
  resources: Map<string, unknown>;
  cleanup: (() => Promise<void>)[];
}
const requests = new AsyncLocalStorage<WorkerRequest>();
export function currentWorkerRequest(): WorkerRequest | undefined {
  return requests.getStore();
}
export function requestResource<T>(key: string, create: () => T): T | undefined {
  const scope = requests.getStore();
  if (!scope) return undefined;
  if (!scope.resources.has(key)) scope.resources.set(key, create());
  return scope.resources.get(key) as T;
}

/** Deferred SSR reads keep their connection until the body finishes or is cancelled. */
export async function runWorkerRequest(
  connectionString: string,
  handler: () => Promise<Response>,
  options: { apiTransport?: ServerApiTransport } = {},
): Promise<Response> {
  const scope: WorkerRequest = {
    connectionString,
    resources: new Map(),
    cleanup: [],
    apiTransport: options.apiTransport,
  };
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await Promise.all(scope.cleanup.map((close) => close()));
  };
  return requests.run(scope, async () => {
    try {
      const response = await handler();
      if (!response.body) {
        await release();
        return response;
      }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          return requests.run(scope, async () => {
            try {
              const result = await reader.read();
              if (result.done) {
                await release();
                controller.close();
              } else controller.enqueue(result.value);
            } catch (error) {
              await release();
              controller.error(error);
            }
          });
        },
        cancel(reason) {
          return requests.run(scope, async () => {
            try {
              await reader.cancel(reason);
            } finally {
              await release();
            }
          });
        },
      });
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      await release();
      throw error;
    }
  });
}
