import type { Env } from '../types/env.js';
import type { RunRestartResponse } from '../types/api.js';
import { json, badRequest, methodNotAllowed, unauthorized, forbidden } from "../lib/http.js";
import { getActiveRun, createRun } from "../lib/run.js";
import { authenticateRequest } from '../lib/auth.js';
import { getUserPaidFlag } from '../lib/paid.js';

interface RunRestartHandlerContext {
  request: Request;
  env: Env;
  url: URL;
}

export async function runRestartHandler({ request, env, url }: RunRestartHandlerContext): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();

  // JWT認証
  const authContext = await authenticateRequest(request, env.JWT_SIGNING_SECRET, env);
  if (!authContext) {
    return unauthorized('Invalid or missing JWT');
  }

  const user_id = authContext.memberId;

  const isPaid = await getUserPaidFlag(env, user_id);
  if (!isPaid) {
    return forbidden('Paid access required');
  }

  const active = await getActiveRun(env, user_id);
  if (active) return badRequest("active run exists");

  const run = await createRun(env, user_id);

  const response: RunRestartResponse = {
    ok: true,
    run: { id: run.id, run_no: run.run_no, status: run.status },
  };
  return json(response);
}
