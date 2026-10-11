/** Keep API CPU in its Python Durable Object while preserving streamed responses. */
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/discovery/")) {
      url.pathname = url.pathname.slice("/discovery".length);
      return env.DISCOVERY_RUNTIME.getByName("compatibility").fetch(
        new Request(url, request),
      );
    }
    // This isolated, read-only evaluation object tests DB proximity without
    // moving existing durable state. Atlas's retained PostgreSQL is us-east-2;
    // Cloudflare treats this first-creation hint as best effort.
    return env.API_RUNTIME.getByName("compatibility-database-east", {
      locationHint: "enam",
    }).fetch(request);
  },
};
