/** Keep API CPU in its Python Durable Object while preserving streamed responses. */
export default {
  fetch(request, env) {
    return env.API_RUNTIME.getByName("compatibility").fetch(request);
  },
};
