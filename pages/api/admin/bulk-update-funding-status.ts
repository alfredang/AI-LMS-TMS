import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { recordCourseChanges } from '../../../lib/courseChangeLog';

interface FundingUpdateRow {
  newCode?: string;
  oldCode?: string;
  title?: string;
  fundingValidity?: string; // yyyy-mm-dd
  casScore?: number;
  esScore?: number;
  whitelist?: boolean;
  renew?: boolean;
}

const isYMD = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { updates } = req.body as { updates: FundingUpdateRow[] };

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ success: false, message: 'No update rows provided.' });
  }
  if (updates.length > 2000) {
    return res.status(400).json({ success: false, message: 'Too many rows in one upload (max 2000).' });
  }

  const results: Array<{ refCode: string; title: string; action: 'updated' | 'unchanged' | 'failed'; message: string }> = [];
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  const authUser = (req as any).authUser;
  const author = authUser?.isService ? { userName: 'System' } : { userId: authUser?.id || null };

  const client = await pool.connect();
  try {
    for (const row of updates) {
      const newCode = typeof row.newCode === 'string' ? row.newCode.trim() : '';
      const oldCode = typeof row.oldCode === 'string' ? row.oldCode.trim() : '';
      const label = newCode || oldCode || '(no ref code)';
      const title = typeof row.title === 'string' ? row.title : '';

      if (!newCode && !oldCode) {
        results.push({ refCode: label, title, action: 'failed', message: 'Row has no Course Ref Code.' });
        failed++;
        continue;
      }

      // Validate the supplied values up front. A field absent from the row is
      // never written; a blank cell in the Excel means "leave unchanged", not
      // "clear".
      let fundingValidity: string | undefined;
      let casScore: number | undefined;
      let esScore: number | undefined;

      if (row.fundingValidity !== undefined) {
        if (!isYMD(row.fundingValidity)) {
          results.push({ refCode: label, title, action: 'failed', message: `Invalid Validity End Date "${row.fundingValidity}" (expected a date).` });
          failed++;
          continue;
        }
        fundingValidity = row.fundingValidity;
      }
      if (row.casScore !== undefined) {
        casScore = Number(row.casScore);
        if (Number.isNaN(casScore)) {
          results.push({ refCode: label, title, action: 'failed', message: `Invalid CAS value "${row.casScore}".` });
          failed++;
          continue;
        }
      }
      if (row.esScore !== undefined) {
        esScore = Number(row.esScore);
        if (Number.isNaN(esScore)) {
          results.push({ refCode: label, title, action: 'failed', message: `Invalid ES value "${row.esScore}".` });
          failed++;
          continue;
        }
      }
      if (fundingValidity === undefined && casScore === undefined && esScore === undefined
        && typeof row.whitelist !== 'boolean' && typeof row.renew !== 'boolean') {
        results.push({ refCode: label, title, action: 'unchanged', message: 'No updatable values in this row.' });
        unchanged++;
        continue;
      }

      try {
        await client.query('BEGIN');

        // Resolve by the current (new) ref code first, then the original code.
        // Uploaded files carry both columns, so a course keeps matching even
        // after a renewal changed its current code.
        const found = await client.query(
          `SELECT id, funding_validity, cas_score, es_score, renewed_status, whitelist_status
           FROM public.course
           WHERE ($1 <> '' AND (new_course_code = $1 OR course_code = $1))
              OR ($2 <> '' AND course_code = $2)
           LIMIT 2`,
          [newCode, oldCode]
        );

        if (found.rows.length === 0) {
          await client.query('ROLLBACK');
          results.push({ refCode: label, title, action: 'failed', message: 'No course matches this ref code.' });
          failed++;
          continue;
        }
        if (found.rows.length > 1) {
          await client.query('ROLLBACK');
          results.push({ refCode: label, title, action: 'failed', message: 'Ref code matches more than one course — update it from the dashboard instead.' });
          failed++;
          continue;
        }

        const current = found.rows[0];
        const courseId = current.id;

        // Write only real differences, so re-uploading an unedited template is
        // a no-op and the summary's "updated" count means something.
        const setClauses: string[] = [];
        const params: any[] = [];
        const logIncoming: Record<string, any> = {};

        // pg hands DATE columns back as a Date at local midnight — format it in
        // local time (toISOString would shift a day in UTC+8).
        const currentValidity = current.funding_validity instanceof Date
          ? `${current.funding_validity.getFullYear()}-${String(current.funding_validity.getMonth() + 1).padStart(2, '0')}-${String(current.funding_validity.getDate()).padStart(2, '0')}`
          : String(current.funding_validity ?? '').slice(0, 10);
        if (fundingValidity !== undefined && fundingValidity !== currentValidity) {
          params.push(fundingValidity);
          setClauses.push(`funding_validity = $${params.length}`);
          logIncoming.fundingValidity = fundingValidity;
        }
        if (casScore !== undefined && casScore !== (current.cas_score != null ? Number(current.cas_score) : null)) {
          params.push(casScore);
          setClauses.push(`cas_score = $${params.length}`);
        }
        if (esScore !== undefined && esScore !== (current.es_score != null ? Number(current.es_score) : null)) {
          params.push(esScore);
          setClauses.push(`es_score = $${params.length}`);
        }

        // Whitelist / Renew are Yes/No in the sheet, but the DB stores richer
        // statuses (e.g. renewed_status = 'Approved / Renewed'). Only write when
        // the Yes/No actually flips the stored truthiness, so a round-trip never
        // downgrades an existing status to the generic value.
        const hasRenewed = !!String(current.renewed_status ?? '').trim();
        const hasWhitelist = !!String(current.whitelist_status ?? '').trim();
        if (typeof row.whitelist === 'boolean' && row.whitelist !== hasWhitelist) {
          params.push(row.whitelist ? 'Whitelisted' : null);
          setClauses.push(`whitelist_status = $${params.length}`);
        }
        if (typeof row.renew === 'boolean' && row.renew !== hasRenewed) {
          params.push(row.renew ? 'To Renew' : null);
          setClauses.push(`renewed_status = $${params.length}`);
        }

        if (setClauses.length === 0) {
          await client.query('ROLLBACK');
          results.push({ refCode: label, title, action: 'unchanged', message: 'Already up to date.' });
          unchanged++;
          continue;
        }

        // Course Change Control entry for funding validity changes; best-effort,
        // same pattern as update-course-validity.
        if (Object.keys(logIncoming).length > 0) {
          try {
            await client.query('SAVEPOINT before_change_log');
            await recordCourseChanges(client, courseId, logIncoming, author, 'Excel bulk update');
            await client.query('RELEASE SAVEPOINT before_change_log');
          } catch (logError) {
            await client.query('ROLLBACK TO SAVEPOINT before_change_log');
            console.error('Course change log skipped:', (logError as Error).message);
          }
        }

        params.push(courseId);
        await client.query(
          `UPDATE public.course
           SET ${setClauses.join(', ')}, updated_at = NOW()
           WHERE id = $${params.length}`,
          params
        );

        await client.query('COMMIT');
        results.push({ refCode: label, title, action: 'updated', message: 'Updated.' });
        updated++;
      } catch (rowError) {
        await client.query('ROLLBACK');
        const msg = rowError instanceof Error ? rowError.message : 'Unknown error';
        results.push({ refCode: label, title, action: 'failed', message: msg });
        failed++;
      }
    }
  } finally {
    client.release();
  }

  return res.status(200).json({ success: true, data: { updated, unchanged, failed, results } });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
