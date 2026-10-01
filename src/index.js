export default {
  async fetch(request, env, ctx) {
    return new Response('Not Found', { status: 404 });
  },
  async scheduled(controller, env, ctx) {
    // filled in Task 5
  },
};