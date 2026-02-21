import type { Env } from './types/env.js';
import { notFound, methodNotAllowed } from "./lib/http.js";

type HandlerContext = {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
};

type RouteHandler = (context: HandlerContext) => Promise<Response> | Response;

interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

interface Router {
  on: (method: string, path: string, handler: RouteHandler) => void;
  handle: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
}

export function createRouter(): Router {
  const routes: Route[] = [];

  function on(method: string, path: string, handler: RouteHandler): void {
    routes.push({ method, path, handler });
  }

  async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // exact matchだけ（今はこれで十分）
    const route = routes.find(
      (r) => r.method === request.method && r.path === url.pathname
    );

    // OPTIONS は共通で worker.js 側で処理するのでここでは触らない
    if (!route) {
      // パスはあるがメソッド違いを分けたいならここで判定可能
      const samePath = routes.some((r) => r.path === url.pathname);
      return samePath ? methodNotAllowed() : notFound();
    }

    return route.handler({ request, env, ctx, url });
  }

  return { on, handle };
}
