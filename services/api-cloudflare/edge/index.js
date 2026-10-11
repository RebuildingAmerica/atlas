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
    return env.API_RUNTIME.getByName("compatibility").fetch(request);
  },
};
