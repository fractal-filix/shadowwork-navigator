import type { HealthResponse } from '../types/api.js';
import { json } from "../lib/http.js";

export async function healthHandler(): Promise<Response> {
  const response: HealthResponse = { ok: true };
  return json(response);
}
