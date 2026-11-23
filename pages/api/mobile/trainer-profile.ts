import type { NextApiResponse } from 'next';
import { withAuth, AuthedApiRequest } from '../../../lib/auth/withAuth';
import pool from '../../../lib/db';
import { ensureMobileSchema } from '../../../lib/mobile/schema';

/**
 * The signed-in trainer's credential badges and tags, for the apps.
 *   GET  → {aclp, dddpl, taepp, areasOfExpertise[], skillsTags[]}
 *   POST {aclp?, dddpl?, taepp?, areasOfExpertise?, skillsTags?} → saves what is sent
 * ACLP is trainer_profile.trainer_type (ACLP / non-ACLP), the field the website edits, so the
 * two never disagree; turning ACLP off leaves a DACE trainer type alone. DDDPL and TAEPP are
 * their own fields. Domain expertise and skill tags are the website's areas_of_expertise and
 * skills_tags. Only the caller's own profile, never one named in the request.
 */
const tags = (v: unknown): string[] | undefined => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    const t = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
    if (out.length >= 30) break;
  }
  return out;
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

async function read(userId: string) {
  const r = (await pool.query(
    `SELECT trainer_type::text AS type, dddpl, taepp, areas_of_expertise, skills_tags
       FROM trainer_profile WHERE user_id = $1`,
    [userId]
  )).rows[0];
  if (!r) return null;
  return {
    aclp: r.type === 'ACLP',
    dddpl: !!r.dddpl,
    taepp: !!r.taepp,
    areasOfExpertise: list(r.areas_of_expertise),
    skillsTags: list(r.skills_tags),
  };
}

export default withAuth(async (req: AuthedApiRequest, res: NextApiResponse) => {
  const user = req.authUser!;
  if (user.isService || !user.roles.has('trainer')) {
    return res.status(403).json({ error: 'Trainer access required' });
  }
  try {
    await ensureMobileSchema();
    if (req.method === 'GET') {
      const p = await read(user.id);
      return p ? res.json(p) : res.status(404).json({ error: 'No trainer profile' });
    }
    if (req.method !== 'POST') return res.status(405).end();

    const b = req.body || {};
    const sets: string[] = [];
    const vals: unknown[] = [];
    const param = (v: unknown) => {
      vals.push(v);
      return `$${vals.length}`;
    };
    if (b.aclp === true) {
      sets.push(`trainer_type = 'ACLP'::trainer_type`);
    } else if (b.aclp === false) {
      sets.push(`trainer_type = CASE WHEN trainer_type::text = 'ACLP' THEN 'non-ACLP'::trainer_type ELSE trainer_type END`);
    }
    if (typeof b.dddpl === 'boolean') sets.push(`dddpl = ${param(b.dddpl)}`);
    if (typeof b.taepp === 'boolean') sets.push(`taepp = ${param(b.taepp)}`);
    const expertise = tags(b.areasOfExpertise);
    const skills = tags(b.skillsTags);
    if (expertise) sets.push(`areas_of_expertise = ${param(JSON.stringify(expertise))}::jsonb`);
    if (skills) sets.push(`skills_tags = ${param(JSON.stringify(skills))}::jsonb`);
    if (!sets.length) return res.status(400).json({ error: 'Nothing to save.' });

    const r = await pool.query(
      `UPDATE trainer_profile SET ${sets.join(', ')} WHERE user_id = ${param(user.id)}`,
      vals
    );
    if (!r.rowCount) return res.status(404).json({ error: 'No trainer profile' });
    return res.json(await read(user.id));
  } catch {
    return res.status(500).json({ error: 'Your profile could not be saved. Please try again.' });
  }
}, { roles: ['trainer'] });
