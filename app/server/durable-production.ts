import app from "./worker";

type ApplicationEnv = Parameters<typeof app.fetch>[1];
interface ProductionEdgeEnv {
  APP_RUNTIME: {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  };
}

/** Reuse immutable app code while each visitor keeps their own auth and database scope. */
export class AtlasAppRuntime {
  constructor(
    _context: unknown,
    private readonly env: ApplicationEnv,
  ) {}

  fetch(request: Request): Promise<Response> {
    return app.fetch(request, this.env);
  }
}

// Four fixed production objects bound placement without creating visitor state.
// The application owns every request and stream's identity and database handles.
let nextShard = 0;
export default {
  fetch(request: Request, env: ProductionEdgeEnv): Promise<Response> {
    const shard = nextShard;
    nextShard = (nextShard + 1) % 4;
    return env.APP_RUNTIME.getByName(`application-${shard}`).fetch(request);
  },
};
