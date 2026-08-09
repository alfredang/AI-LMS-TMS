import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

/**
 * Read-only view of every code each course has carried, so it is possible to
 * see at a glance which funding renewals have landed without querying the DB.
 *
 * Optional ?q= filters on title or on any code in the course's history.
 */
interface CodeEntry {
  code: string;
  isCurrent: boolean;
  validFrom: string | null;
  validTo: string | null;
  /** The date this value took effect: valid_from, else the day after the previous
   *  value ended. Null when the change predates date tracking. */
  effectiveFrom: string | null;
}

interface TitleEntry {
  title: string;
  isCurrent: boolean;
  validFrom: string | null;
  validTo: string | null;
  effectiveFrom: string | null;
}

/** One line of the change log: "on this date, this field changed from X to Y". */
interface ChangeEvent {
  date: string | null;
  field: 'code' | 'title';
  from: string;
  to: string;
}

interface CourseCodeRow {
  courseId: string;
  title: string;
  courseType: string | null;
  fundingValidity: string | null;
  fundingValid: boolean | null;
  enrolments: number;
  runs: number;
  codes: CodeEntry[];
  titles: TitleEntry[];
  changes: ChangeEvent[];
}

/** A DB row before effective dates are worked out. */
interface RawEntry {
  isCurrent: boolean;
  validFrom: string | null;
  validTo: string | null;
}

const toDate = (v: string | Date | null): string | null => {
  if (!v) return null;
  const s = typeof v === 'string' ? v : v.toISOString();
  return s.slice(0, 10);
};

/** The day after `date`, used to open a value the moment its predecessor closed. */
const dayAfter = (date: string | null): string | null => {
  if (!date) return null;
  const dt = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
};

/**
 * Work out when each value took effect.
 *
 * `valid_from` is authoritative when set. Where it is absent but the preceding
 * value has a `valid_to`, the change is still known exactly -- this value opened
 * the day the previous one closed.
 *
 * Beyond that there is nothing to go on. Rows created by the backfill from the
 * legacy course_code/new_course_code columns carry no dates, and `created_at` is
 * only when the migration ran (the same timestamp for every course), so it is
 * NOT used as a fallback -- it would put one arbitrary date against changes that
 * actually happened years apart. Those entries report a null date and the UI says
 * so plainly rather than passing a guess off as a fact.
 *
 * `entries` must already be in chronological order.
 */
function withEffectiveDates<T extends RawEntry>(
  entries: T[]
): (T & { effectiveFrom: string | null })[] {
  return entries.map((e, i) => {
    if (e.validFrom) {
      return { ...e, effectiveFrom: toDate(e.validFrom) };
    }
    // The predecessor's end date dates this one exactly: it opened when that closed.
    const prevEnd = i > 0 ? toDate(entries[i - 1].validTo) : null;
    return { ...e, effectiveFrom: dayAfter(prevEnd) };
  });
}

/**
 * Turn the code and title timelines into one chronological change log.
 *
 * The first value of each timeline is the course's original -- it is not a
 * change, so only transitions between consecutive values are emitted.
 */
function buildChangeLog(codes: CodeEntry[], titles: TitleEntry[]): ChangeEvent[] {
  const events: ChangeEvent[] = [];

  for (let i = 1; i < codes.length; i++) {
    events.push({
      date: codes[i].effectiveFrom,
      field: 'code',
      from: codes[i - 1].code,
      to: codes[i].code,
    });
  }

  for (let i = 1; i < titles.length; i++) {
    events.push({
      date: titles[i].effectiveFrom,
      field: 'title',
      from: titles[i - 1].title,
      to: titles[i].title,
    });
  }

  // Newest first. Undated events sort last rather than pretending to be oldest.
  return events.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const renewedOnly = req.query.renewedOnly === '1' || req.query.renewedOnly === 'true';

  try {
    const { rows } = await pool.query(
      `SELECT c.id::text                AS course_id,
              c.title,
              c.course_type::text       AS course_type,
              c.funding_validity,
              CASE WHEN NULLIF(c.funding_validity,'') IS NULL THEN NULL
                   ELSE c.funding_validity::date > CURRENT_DATE END AS funding_valid,
              (SELECT count(*) FROM public.enrollment e WHERE e.course_id = c.id)::int  AS enrolments,
              (SELECT count(*) FROM public.course_run r WHERE r.course_id = c.id)::int  AS runs,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'code',        h.code,
                         'isCurrent',   h.is_current,
                         'validFrom',   h.valid_from,
                         'validTo',     h.valid_to)
                       ORDER BY h.is_current,
                                COALESCE(h.valid_from, h.valid_to, h.created_at::date),
                                h.code)
                  FROM public.course_code_history h
                 WHERE h.course_id = c.id), '[]'::json)                                 AS codes,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'title',       t.title,
                         'isCurrent',   t.is_current,
                         'validFrom',   t.valid_from,
                         'validTo',     t.valid_to)
                       ORDER BY t.is_current,
                                COALESCE(t.valid_from, t.valid_to, t.created_at::date),
                                t.title)
                  FROM public.course_title_history t
                 WHERE t.course_id = c.id), '[]'::json)                                 AS titles,
              (SELECT count(*) FROM public.course_code_history h WHERE h.course_id = c.id)::int AS n_codes
         FROM public.course c
        WHERE ($1 = '' OR c.title ILIKE '%'||$1||'%'
               OR EXISTS (SELECT 1 FROM public.course_code_history h
                           WHERE h.course_id = c.id AND h.code ILIKE '%'||$1||'%')
               OR EXISTS (SELECT 1 FROM public.course_title_history t
                           WHERE t.course_id = c.id AND t.title ILIKE '%'||$1||'%'))
        ORDER BY c.title`,
      [q]
    );

    const courses: CourseCodeRow[] = rows
      .filter(r => !renewedOnly || r.n_codes > 1)
      .map(r => {
        const codes = withEffectiveDates(r.codes as RawEntry[]) as CodeEntry[];
        const titles = withEffectiveDates(r.titles as RawEntry[]) as TitleEntry[];
        return {
          courseId: r.course_id,
          title: r.title,
          courseType: r.course_type,
          fundingValidity: r.funding_validity,
          fundingValid: r.funding_valid,
          enrolments: r.enrolments,
          runs: r.runs,
          codes,
          titles,
          changes: buildChangeLog(codes, titles),
        };
      });

    return res.status(200).json({
      total: courses.length,
      renewed: courses.filter(c => c.codes.length > 1).length,
      courses,
    });
  } catch (error: any) {
    console.error('Failed to load course code history:', error);
    return res.status(500).json({ message: error.message || 'Failed to load' });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
