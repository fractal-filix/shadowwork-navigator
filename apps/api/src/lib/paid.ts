import type { Env } from '../types/env.js';
import type { UserFlagRow } from '../types/database.js';

export async function getUserPaidFlag(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB
    .prepare('SELECT paid FROM user_flags WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first<Pick<UserFlagRow, 'paid'>>();

  return row ? row.paid === 1 : false;
}
