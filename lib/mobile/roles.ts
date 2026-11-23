import pool from '../db';

// The roles the learner/trainer apps can show, in display order. Signing in needs Learner or
// Trainer; Developer is added when the same account also holds it, so one email can switch
// between its views in the app. Every endpoint still checks the role it serves.
export const APP_ROLES = ['learner', 'trainer', 'developer'] as const;
export const SIGN_IN_ROLES = ['learner', 'trainer'];

/** Orders and filters held roles to APP_ROLES; [] when the account may not sign in. */
export function appRoles(held: Iterable<string>): string[] {
  const set = new Set([...held].map((r) => r.toLowerCase()));
  if (!SIGN_IN_ROLES.some((r) => set.has(r))) return [];
  return APP_ROLES.filter((r) => set.has(r));
}

/** The app roles of one user, from user_role_map. */
export async function loadAppRoles(
  userId: string,
  db: { query: (sql: string, params: unknown[]) => Promise<{ rows: { role: string }[] }> } = pool
): Promise<string[]> {
  const rows = (await db.query(
    `SELECT lower(role::text) AS role FROM user_role_map WHERE user_id = $1 AND lower(role::text) IN ('learner','trainer','developer')`,
    [userId]
  )).rows;
  return appRoles(rows.map((r) => r.role));
}
