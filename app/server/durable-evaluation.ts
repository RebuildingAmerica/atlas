import app from "./worker";

type ApplicationEnv = Parameters<typeof app.fetch>[1];
interface EvaluationEdgeEnv {
  APP_RUNTIME: {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  };
}

/**
 * Diagnostic only: measure whether Free Durable Objects can preserve Atlas's
 * account and SSR experience when ordinary Workers cannot meet the CPU gate.
 * No object storage, sessions, sockets, timers or migrations live on this class.
 */
export class AtlasAppRuntime {
  constructor(
    _context: unknown,
    private readonly env: ApplicationEnv,
  ) {}

  fetch(request: Request): Promise<Response> {
    return app.fetch(request, this.env);
  }
}

// Four fixed objects bound the experiment's placement and duration exposure.
// This is not a production placement or scaling policy. Identity and database
// clients are still owned by each request inside the existing application.
let nextShard = 0;
export default {
  fetch(request: Request, env: EvaluationEdgeEnv): Promise<Response> {
    return env.APP_RUNTIME.getByName(`evaluation-${nextShard++ % 4}`).fetch(request);
  },
};
