import crypto from 'crypto';
import pool from '../db';
import { getSSGCredentialsService } from './services/credentials-service';
import { getTrainingPartnerIdentifiers } from '../trainingPartnerIdentifiers';
import { HttpClient, HTTPRequestBuilder, HttpMethod } from './utils/http-utils';

/**
 * Course → SSG assessment skill-code resolution + cache (course_skill_code table).
 *
 * SSG validates an assessment's `skillCode` against the course's registered competency, but no
 * SSG course/run API exposes it. It IS present on the course's EXISTING assessment records, so we
 * read it from there. The value is stable per course (a property of the SSG registration), so we
 * cache it: cache-hit is instant; a cache-miss does ONE live SSG lookup and caches it. The bulk
 * assessment view auto-fills from this (a pasted skill code on a row still overrides).
 */

const IV = Buffer.from('SSGAPIInitVector', 'utf8');

export async function ensureSkillCodeTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_skill_code (
      course_code TEXT PRIMARY KEY,
      skill_code  TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

interface SsgCtx { creds: any; tp: { uen: string; code: string }; baseUrl: string; }

async function getCtx(): Promise<SsgCtx | null> {
  const creds = await getSSGCredentialsService().getSSGCredentials();
  if (!creds) return null;
  const tp = await getTrainingPartnerIdentifiers();
  const baseUrl = (creds as any).ssgApiBaseUrl || process.env.SSG_API_URL || process.env.SSG_API_BASE_URL || 'https://api.ssg-wsg.sg';
  return { creds, tp, baseUrl };
}

/** Search ONE run's existing assessments and return the first non-empty skillCode (or null). */
async function searchRunSkillCode(ctx: SsgCtx, ssgRunId: string, courseRef: string): Promise<string | null> {
  const payload = {
    parameters: { page: 0, pageSize: 100 },
    assessments: {
      course: { run: { id: String(ssgRunId) }, referenceNumber: String(courseRef) },
      trainingPartner: { uen: ctx.creds.uen || ctx.tp.uen, code: ctx.tp.code },
    },
  };
  const encKey = Buffer.from(ctx.creds.encryptionKey, 'base64');
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey, IV);
  let body = cipher.update(JSON.stringify(payload), 'utf8', 'base64'); body += cipher.final('base64');
  const b = new HTTPRequestBuilder().withEndpoint(ctx.baseUrl, '/tpg/assessments/search').withMethod(HttpMethod.POST).withBody(body);
  if (ctx.creds.certificateContent && ctx.creds.privateKeyContent) b.withCertificate(ctx.creds.certificateContent, ctx.creds.privateKeyContent);
  const client = new HttpClient(ctx.baseUrl, { 'Content-Type': 'application/json', Accept: 'application/json' });
  const r = await client.request(b.build());
  if (r.status !== 200) return null;
  const raw = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  let parsed: any;
  try { const d = crypto.createDecipheriv('aes-256-cbc', encKey, IV); let s = d.update(raw, 'base64', 'utf8'); s += d.final('utf8'); parsed = JSON.parse(s); } catch { return null; }
  if (parsed?.error && (parsed.error.code || parsed.error.message)) return null;
  for (const item of (parsed?.data ?? [])) {
    const a = item?.assessment ?? item;
    if (a?.skillCode && String(a.skillCode).trim()) return String(a.skillCode).trim();
  }
  return null;
}

/** Live-resolve a course's skill code from SSG (search its recent completed enrolled runs). */
async function liveResolveSkillCode(ctx: SsgCtx, courseCode: string, runsPerCourse = 3): Promise<string | null> {
  const runs = (await pool.query<{ course_run_id: string }>(
    `SELECT cr.course_run_id
       FROM course c JOIN course_run cr ON cr.course_id = c.id
      WHERE c.course_code = $1 AND NULLIF(btrim(cr.course_run_id), '') IS NOT NULL
        AND cr.end_date < CURRENT_DATE
        AND EXISTS (SELECT 1 FROM enrollment e WHERE e.course_run_id = cr.id)
      ORDER BY cr.end_date DESC NULLS LAST
      LIMIT $2`,
    [courseCode, runsPerCourse]
  )).rows;
  for (const r of runs) {
    try { const sc = await searchRunSkillCode(ctx, r.course_run_id, courseCode); if (sc) return sc; } catch { /* skip run */ }
  }
  return null;
}

/** Read cached skill codes for the given course codes. */
export async function getCachedSkillCodes(courseCodes: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const codes = Array.from(new Set(courseCodes.map((c) => c.trim()).filter(Boolean)));
  if (codes.length === 0) return map;
  const r = await pool.query<{ course_code: string; skill_code: string }>(
    `SELECT course_code, skill_code FROM course_skill_code WHERE course_code = ANY($1::text[])`, [codes]
  );
  for (const row of r.rows) map[row.course_code] = row.skill_code;
  return map;
}

export async function upsertSkillCodes(items: Array<{ course_code?: string; skill_code?: string }>): Promise<number> {
  await ensureSkillCodeTable();
  let saved = 0;
  for (const it of items) {
    const cc = String(it.course_code || '').trim();
    const sc = String(it.skill_code || '').trim();
    if (!cc || !sc) continue;
    await pool.query(
      `INSERT INTO course_skill_code (course_code, skill_code, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (course_code) DO UPDATE SET skill_code = EXCLUDED.skill_code, updated_at = now()`,
      [cc, sc]
    );
    saved++;
  }
  return saved;
}

/**
 * Force a fresh live lookup for ONE course (ignores the cache) and update the cache with the
 * result. Used by the bulk-assessment self-repair: when a row fails on a skill-code error, the
 * cached value may be stale/wrong, so re-pull the authoritative code from SSG's existing
 * assessments and correct the cache. Returns the fresh code (or null if none could be resolved).
 */
export async function refreshSkillCode(courseCode: string): Promise<string | null> {
  const cc = String(courseCode || '').trim();
  if (!cc) return null;
  const ctx = await getCtx();
  if (!ctx) return null;
  const sc = await liveResolveSkillCode(ctx, cc);
  if (sc) await upsertSkillCodes([{ course_code: cc, skill_code: sc }]);
  return sc;
}

/**
 * Cache-first resolution with live SSG fallback + auto-cache. Cached courses cost nothing;
 * an unmapped (e.g. brand-new) course triggers ONE live SSG lookup and is cached for next time.
 * Pass { live: false } to read cache only.
 */
export async function resolveAndCacheSkillCodes(courseCodes: string[], opts?: { live?: boolean; allowAllRuns?: boolean }): Promise<Record<string, string>> {
  await ensureSkillCodeTable();
  const codes = Array.from(new Set(courseCodes.map((c) => c.trim()).filter(Boolean)));
  const map = await getCachedSkillCodes(codes);
  const missing = codes.filter((c) => !map[c]);
  if (missing.length === 0 || opts?.live === false) return map;
  const ctx = await getCtx();
  if (!ctx) return map;
  for (const c of missing) {
    const sc = await liveResolveSkillCode(ctx, c);
    if (sc) { await upsertSkillCodes([{ course_code: c, skill_code: sc }]); map[c] = sc; }
  }
  return map;
}
