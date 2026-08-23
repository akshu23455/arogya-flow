/** Cloudflare Worker entry point for ArogyaFlow. */
import handler from "vinext/server/app-router-entry";

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Cloudflare.Env>;

export default worker;
