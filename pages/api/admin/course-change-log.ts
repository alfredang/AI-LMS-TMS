import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * The Course Change Control feed: every recorded course field change, newest
 * first, as flat rows ready to render as a table.
 *
 * Reads course_change_log only. The two history tables remain the source of
 * truth for resolving a code or title back to a course; this endpoint is the
 * human-readable narrative and is never used to decide behaviour.
 *
 * Optional ?q= filters on course title (current title, or any title the course
 * has ever carried, so searching a former name still finds its changes).
 */
interface ChangeRow {
  id: string;
  courseId: string;
  courseTitle: string;
  courseType: string | null;
  currentCode: string | null;
  field: string;
  fieldLabel: string;
  oldValue: string | null;
  newValue: string | null;
  /** ISO date, or null when the change predates date tracking. */
  changedAt: string | null;
  changedByName: string | null;
  note: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  try {
    const { rows } = await pool.query(
      `SELECT l.id::text,
              l.course_id::text                     AS course_id,
              c.title                               AS course_title,
              c.course_type::text                   AS course_type,
              COALESCE(NULLIF(c.new_course_code,''), c.course_code) AS current_code,
              l.field,
              l.field_label,
              l.old_value,
              l.new_value,
              -- The backfill parks undated changes at the epoch sentinel; surface
              -- those as NULL so the UI says "not recorded" instead of 1970.
              CASE WHEN l.changed_at = 'epoch'::timestamptz THEN NULL
                   ELSE l.changed_at END            AS changed_at,
              l.changed_by_name,
              l.note
         FROM public.course_change_log l
         JOIN public.course c ON c.id = l.course_id
        WHERE ($1 = ''
               OR c.title ILIKE '%'||$1||'%'
               OR EXISTS (SELECT 1 FROM public.course_title_history t
                           WHERE t.course_id = c.id AND t.title ILIKE '%'||$1||'%'))
        -- Undated changes sort last rather than masquerading as the oldest.
        ORDER BY (l.changed_at = 'epoch'::timestamptz), l.changed_at DESC, c.title`,
      [q]
    );

    const changes: ChangeRow[] = rows.map(r => ({
      id: r.id,
      courseId: r.course_id,
      courseTitle: r.course_title,
      courseType: r.course_type,
      currentCode: r.current_code,
      field: r.field,
      fieldLabel: r.field_label,
      oldValue: r.old_value,
      newValue: r.new_value,
      changedAt: r.changed_at ? new Date(r.changed_at).toISOString() : null,
      changedByName: r.changed_by_name,
      note: r.note,
    }));

    return res.status(200).json({ total: changes.length, changes });
  } catch (error: any) {
    // The table ships with a migration; if it has not been applied yet, report an
    // empty log rather than failing the page.
    if (error?.code === '42P01') {
      return res.status(200).json({ total: 0, changes: [], pendingMigration: true });
    }
    console.error('Failed to load course change log:', error);
    return res.status(500).json({ message: error.message || 'Failed to load' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
