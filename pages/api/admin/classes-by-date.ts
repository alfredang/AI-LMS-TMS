import { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../lib/db';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';
import { normalizeTrainerName, splitTrainerList } from '@/lib/trainerInvitations';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CalendarEvent {
  courseRunUuid: string;
  courseRunId: string;
  courseTitle: string;
  courseCode: string;
  classStatus: 'Pending' | 'Confirmed' | 'Cancelled' | string;
  classType: string;
  sessionDate: string;   // YYYY-MM-DD (formatted for UI)
  startTime: string;
  endTime: string;
  dayNumber: number;
  sessionNumbers: string[]; // e.g. ["3","4"] — session_numbers covered by this date
  // All unique session dates for this course run (YYYY-MM-DD, ascending).
  // Rendered in the expanded row so the admin sees the full schedule at a glance
  // with the current row's date highlighted.
  allSessionDates: string[];
  numLearners: number;
  tpgTrainerName: string;
  tpgTrainerEmail: string;
  // Preferred local trainer name for the collapsed row header. If TPG trainer
  // matches one of the multiple local trainers, this is that match so the
  // TPG/Local visual comparison lines up. Otherwise it's the first local.
  localTrainerName: string;
  localTrainerEmail: string;
  // All locally assigned trainers for the expanded row detail view.
  localTrainers: Array<{ name: string; email: string }>;
  nextAvailableTrainer: string;
  nextAvailableTrainerEmail: string;
  latestInvitationStatus: string;
  approvedTrainers: string[]; // course.trainers_list split — populates Next Trainer dropdown
  invitationPaused: boolean;
  invitationRepliesBlocked: boolean;
  trainerInvitations: Record<string, Array<{ status: string; sent_at: string; responded_at: string | null }>>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

// course_session.start_date / end_date are stored as compact YYYYMMDD text
// (e.g. "20260322"). Convert UI date (YYYY-MM-DD) → DB format (YYYYMMDD) for
// lexicographic range comparison, which is correct for zero-padded dates.
const isoToCompact = (iso: string): string => iso.replace(/-/g, '');

// YYYYMMDD → YYYY-MM-DD for return payload
const compactToIso = (compact: string): string => {
  if (!compact || compact.length !== 8) return compact || '';
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
};

// Strip calendar event title to bare course name for matching
function stripCalendarTitle(title: string): string {
  return (title || '')
    .replace(/\[(?:WSQ|IBF|VIRTUAL|EXTERNAL|HYBRID)\]\s*/gi, '')
    .replace(/^\*\s*/, '')
    .replace(/^Day\s+\d+\s*[-–]\s*/i, '')
    .replace(/^(?:WSQ|IBF)\s*[-–]\s*/i, '')
    .trim()
    .toLowerCase();
}

// Fetch Google Calendar event titles for a date range, return a Set of stripped course titles
async function getCalendarTitlesForMonth(monthStart: string, monthEnd: string): Promise<Set<string>> {
  try {
    const credentials = await getGoogleCredentials(pool);
    const tpRes = await pool.query('SELECT google_calendar_url FROM training_provider LIMIT 1');
    const calUrl = tpRes.rows[0]?.google_calendar_url || '';
    let calendarId = 'primary';
    if (calUrl) {
      const cidMatch = calUrl.match(/[?&]cid=([^&]+)/);
      if (cidMatch) {
        try { calendarId = Buffer.from(cidMatch[1], 'base64').toString('utf-8'); }
        catch { calendarId = cidMatch[1]; }
      } else if (calUrl.includes('@')) {
        calendarId = calUrl;
      }
    }
    const oauth2Client = new google.auth.OAuth2(
      credentials.clientId, credentials.clientSecret,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const eventsRes = await calendar.events.list({
      calendarId,
      timeMin: new Date(monthStart + 'T00:00:00+08:00').toISOString(),
      timeMax: new Date(monthEnd + 'T23:59:59+08:00').toISOString(),
      singleEvents: true,
      maxResults: 500,
      fields: 'items(summary)',
    });

    const titles = new Set<string>();
    for (const evt of eventsRes.data.items || []) {
      if (!/WSQ|IBF/i.test(evt.summary || '')) continue;
      titles.add(stripCalendarTitle(evt.summary || ''));
    }
    return titles;
  } catch (err) {
    console.error('[classes-by-date] Google Calendar fetch failed (non-fatal):', err);
    return new Set(); // graceful fallback — treat all as unknown
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Ensure invitation_paused column exists
    await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS invitation_paused BOOLEAN DEFAULT false');
    await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS invitation_replies_blocked BOOLEAN DEFAULT false');

    const { monthStart, monthEnd } = req.query;

    if (typeof monthStart !== 'string' || !isoDateRegex.test(monthStart)) {
      return res.status(400).json({ success: false, error: 'monthStart must be YYYY-MM-DD' });
    }
    if (typeof monthEnd !== 'string' || !isoDateRegex.test(monthEnd)) {
      return res.status(400).json({ success: false, error: 'monthEnd must be YYYY-MM-DD' });
    }

    const compactStart = isoToCompact(monthStart);
    const compactEnd = isoToCompact(monthEnd);

    // Detect if trainer_invitation table exists (it may not in older DBs)
    const hasInvitationTable = (
      await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'trainer_invitation' LIMIT 1`)
    ).rows.length > 0;

    // Main query — dedupe by (course_run_id, session_date), compute Day N via
    // DENSE_RANK over ALL unique session dates of each run (not just the
    // filtered window), then filter rows to the window.
    const mainResult = await pool.query(
      `
      WITH all_unique_dates AS (
        SELECT
          cs.course_run_id,
          cs.start_date AS session_date,
          MIN(cs.start_time) AS earliest_start,
          MAX(cs.end_time)   AS latest_end,
          COUNT(*)           AS session_count,
          ARRAY_AGG(cs.session_number ORDER BY cs.start_time, cs.session_number)
            FILTER (WHERE cs.session_number IS NOT NULL AND cs.session_number <> '') AS session_numbers
        FROM course_session cs
        WHERE cs.deleted = false
          AND cs.start_date IS NOT NULL
          AND cs.start_date <> ''
        GROUP BY cs.course_run_id, cs.start_date
      ),
      ranked AS (
        SELECT
          aud.*,
          DENSE_RANK() OVER (
            PARTITION BY aud.course_run_id
            ORDER BY aud.session_date
          ) AS day_number
        FROM all_unique_dates aud
      )
      SELECT
        cr.id AS course_run_uuid,
        cr.course_run_id,
        c.title AS course_title,
        c.course_code,
        c.trainers_list,
        cr.class_status,
        cr.class_type,
        cr.invitation_paused,
        cr.invitation_replies_blocked,
        cr.tpg_assigned_trainer_name,
        cr.tpg_assigned_trainer_email,
        cr.assigned_trainer_name AS legacy_assigned_trainer_name,
        r.session_date,
        r.earliest_start AS start_time,
        r.latest_end AS end_time,
        r.day_number,
        r.session_numbers,
        (SELECT COUNT(*) FROM enrollment e WHERE e.course_run_id = cr.id) AS num_learners
      FROM ranked r
      JOIN course_run cr ON cr.id = r.course_run_id
      JOIN course c ON c.id = cr.course_id
      WHERE r.session_date >= $1 AND r.session_date <= $2
      ORDER BY r.session_date ASC, r.earliest_start ASC, cr.course_run_id ASC
      `,
      [compactStart, compactEnd]
    );

    const rows = mainResult.rows;
    const courseRunIds: string[] = Array.from(new Set(rows.map((row: any) => row.course_run_uuid)));

    // All unique session dates per course run (for the expanded row schedule view).
    // Fetches every distinct course_session.start_date for each CR in the visible set.
    const allDatesMap = new Map<string, string[]>();
    if (courseRunIds.length > 0) {
      const allDatesResult = await pool.query(
        `
        SELECT course_run_id, ARRAY_AGG(DISTINCT start_date ORDER BY start_date ASC) AS dates
          FROM course_session
         WHERE course_run_id = ANY($1::uuid[])
           AND deleted = false
           AND start_date IS NOT NULL
           AND start_date <> ''
         GROUP BY course_run_id
        `,
        [courseRunIds]
      );
      for (const row of allDatesResult.rows) {
        const isoDates = (row.dates || []).map((d: string) => compactToIso(d)).filter(Boolean);
        allDatesMap.set(row.course_run_id, isoDates);
      }
    }

    // Local trainer lookup (course_run_trainer)
    const localTrainerMap = new Map<string, { names: string[]; emails: string[] }>();
    if (courseRunIds.length > 0) {
      const localTrainerResult = await pool.query(
        `
        SELECT course_run_id, trainer_name, trainer_email
        FROM course_run_trainer
        WHERE course_run_id = ANY($1::uuid[])
        ORDER BY assigned_at ASC
        `,
        [courseRunIds]
      );

      for (const row of localTrainerResult.rows) {
        const existing = localTrainerMap.get(row.course_run_id) || { names: [], emails: [] };
        existing.names.push(row.trainer_name || '');
        existing.emails.push(row.trainer_email || '');
        localTrainerMap.set(row.course_run_id, existing);
      }
    }

    // Invitation history lookup
    const invitationMap = new Map<string, any[]>();
    if (hasInvitationTable && courseRunIds.length > 0) {
      const invitationResult = await pool.query(
        `
        SELECT course_run_id, trainer_name, trainer_email, status, created_at, responded_at
        FROM trainer_invitation
        WHERE course_run_id = ANY($1::uuid[])
        ORDER BY created_at DESC
        `,
        [courseRunIds]
      );

      for (const row of invitationResult.rows) {
        const existing = invitationMap.get(row.course_run_id) || [];
        existing.push(row);
        invitationMap.set(row.course_run_id, existing);
      }
    }

    // Build email-based trainer identity map (matches upcoming-classes.ts:364-403).
    // Handles name mismatches like "Dr. Muhammed Siraj" vs "Dr. Siraj Mohammad".
    const nameToEmail = new Map<string, string>();
    const emailToNames = new Map<string, Set<string>>();
    {
      const approvedNames = new Set<string>();
      for (const row of rows) {
        for (const name of splitTrainerList(row.trainers_list)) {
          approvedNames.add(name);
        }
      }
      const localEmails = new Set<string>();
      localTrainerMap.forEach((data) => {
        for (const e of data.emails) {
          if (e) localEmails.add(e.toLowerCase().trim());
        }
      });
      if (approvedNames.size > 0 || localEmails.size > 0) {
        const result = await pool.query(
          `SELECT full_name, email FROM app_user
           WHERE email IS NOT NULL
             AND (full_name = ANY($1::text[]) OR LOWER(email) = ANY($2::text[]))`,
          [Array.from(approvedNames), Array.from(localEmails)]
        );
        for (const r of result.rows) {
          const email = (r.email || '').toLowerCase().trim();
          const name = normalizeTrainerName(r.full_name);
          if (!email) continue;
          nameToEmail.set(name, email);
          if (!emailToNames.has(email)) emailToNames.set(email, new Set());
          emailToNames.get(email)!.add(name);
        }
      }
    }

    // Track which rows we've already triggered a sticky-status write-back for,
    // so we don't UPDATE the same course_run twice when it has multiple rows
    // (multi-session multi-date).
    const statusWriteBackDone = new Set<string>();

    const events: CalendarEvent[] = rows.map((row: any): CalendarEvent => {
      const trainerPool = splitTrainerList(row.trainers_list);
      const normalizedTrainerPool = trainerPool.map((n: string) => normalizeTrainerName(n));
      const localTrainerData = localTrainerMap.get(row.course_run_uuid) || { names: [], emails: [] };
      const allLocalPairs = localTrainerData.names
        .map((name, index) => ({ name, email: localTrainerData.emails[index] || '' }));

      // Build set of ALL normalized names that belong to locally assigned trainers
      const localAssignedAllNames = new Set<string>();
      const localAssignedEmails = new Set<string>();
      for (const pair of allLocalPairs) {
        const normName = normalizeTrainerName(pair.name);
        localAssignedAllNames.add(normName);
        const email = (pair.email || '').toLowerCase().trim();
        if (email) {
          localAssignedEmails.add(email);
          const aliases = emailToNames.get(email);
          if (aliases) {
            aliases.forEach((alias) => localAssignedAllNames.add(alias));
          }
        }
        const resolvedEmail = nameToEmail.get(normName);
        if (resolvedEmail) {
          localAssignedEmails.add(resolvedEmail);
          const aliases = emailToNames.get(resolvedEmail);
          if (aliases) {
            aliases.forEach((alias) => localAssignedAllNames.add(alias));
          }
        }
      }

      const invitations = invitationMap.get(row.course_run_uuid) || [];

      // Check if an approved trainer is locally assigned
      const isLocallyAssigned = (approvedNormalized: string): boolean => {
        if (localAssignedAllNames.has(approvedNormalized)) return true;
        const approvedEmail = nameToEmail.get(approvedNormalized);
        if (approvedEmail && localAssignedEmails.has(approvedEmail)) return true;
        // Word-overlap fallback for "Dr. Siraj Mohammad" vs "Dr. Muhammed Siraj"
        const approvedWords = new Set<string>(approvedNormalized.split(/\s+/).filter((w: string) => w.length > 2));
        if (approvedWords.size > 0) {
          const localNamesArr = Array.from(localAssignedAllNames);
          for (const localName of localNamesArr) {
            const localWords = localName.split(/\s+/).filter((w: string) => w.length > 2);
            const shared = localWords.filter((w: string) => approvedWords.has(w));
            if (shared.length >= 2 || (shared.length >= 1 && (approvedWords.size <= 1 || localWords.length <= 1))) {
              return true;
            }
          }
        }
        return false;
      };

      // Build full per-trainer invitation history (all rows, sorted by date desc).
      // Keyed by normalized trainer name → array of invitation entries.
      const perTrainerInvitations: Record<string, Array<{ status: string; sent_at: string; responded_at: string | null }>> = {};
      for (const inv of invitations) {
        const norm = normalizeTrainerName(inv.trainer_name);
        if (!perTrainerInvitations[norm]) perTrainerInvitations[norm] = [];
        perTrainerInvitations[norm].push({
          status: inv.status,
          sent_at: inv.created_at,
          responded_at: inv.responded_at || null,
        });
      }

      let nextAvailableTrainer = '';
      let nextAvailableTrainerEmail = '';
      let latestInvitationStatus: string = invitations[0]?.status || '';

      const localAssignedIndexes = normalizedTrainerPool
        .map((normalized, idx) => isLocallyAssigned(normalized) ? idx : -1)
        .filter((index) => index >= 0);
      const startIndex = localAssignedIndexes.length > 0
        ? Math.max(...localAssignedIndexes) + 1
        : 0;

      for (let index = startIndex; index < trainerPool.length; index++) {
        const trainerName = trainerPool[index];
        const normalized = normalizedTrainerPool[index];
        if (!normalized || isLocallyAssigned(normalized)) continue;
        const invitation = invitations.find((entry) => normalizeTrainerName(entry.trainer_name) === normalized);
        if (invitation?.status === 'declined' || invitation?.status === 'blocked') continue;
        nextAvailableTrainer = trainerName;
        nextAvailableTrainerEmail = invitation?.trainer_email || nameToEmail.get(normalized) || '';
        if (invitation?.status) {
          latestInvitationStatus = invitation.status;
        } else {
          latestInvitationStatus = '';
        }
        break;
      }

      // Derive class status: sticky-Cancelled, else Confirmed if ANY trainer
      // signal is present (junction-table local, legacy course_run.assigned_trainer_name,
      // or tpg_assigned_trainer_name), else Pending. Mirrors upcoming-classes.ts.
      // Previously this only considered the junction table — rows with a
      // TPG-only trainer OR a legacy (pre-junction) local trainer would be
      // stomped back to Pending on every page load.
      const hasLocalTrainer = !!(allLocalPairs[0]?.name);
      const hasLegacyLocalTrainer = !!((row.legacy_assigned_trainer_name || '').toString().trim());
      const hasTpgTrainer = !!((row.tpg_assigned_trainer_name || '').toString().trim());
      const derivedStatus = (row.class_status === 'Cancelled' || row.class_status === 'Unconfirmed')
        ? row.class_status
        : ((hasLocalTrainer || hasLegacyLocalTrainer || hasTpgTrainer) ? 'Confirmed' : 'Pending');

      // Persist sticky-Confirmed/Pending (never overwrites Cancelled).
      // Dedupe writes across multi-session multi-date rows for the same course run.
      if (row.class_status !== derivedStatus && !statusWriteBackDone.has(row.course_run_uuid)) {
        statusWriteBackDone.add(row.course_run_uuid);
        pool.query(
          `UPDATE course_run SET class_status = $1, updated_at = NOW() WHERE id = $2`,
          [derivedStatus, row.course_run_uuid]
        ).catch((err) => {
          console.error('[classes-by-date] sticky status write-back failed for', row.course_run_uuid, err);
        });
      }

      // Pick the "collapsed row" local display — prefer the match to the TPG
      // trainer so the collapsed TPG/Local comparison lines up when multiple
      // trainers are locally assigned. Match by normalized name OR by email.
      // Fall back to the first local trainer if no match.
      const tpgName = row.tpg_assigned_trainer_name || '';
      const tpgEmail = (row.tpg_assigned_trainer_email || '').toLowerCase().trim();
      const tpgNameNorm = normalizeTrainerName(tpgName);
      let displayLocal: { name: string; email: string } = allLocalPairs[0] || { name: '', email: '' };
      if ((tpgNameNorm || tpgEmail) && allLocalPairs.length > 1) {
        const matched = allLocalPairs.find((p) => {
          const pName = normalizeTrainerName(p.name);
          const pEmail = (p.email || '').toLowerCase().trim();
          if (tpgNameNorm && pName && pName === tpgNameNorm) return true;
          if (tpgEmail && pEmail && pEmail === tpgEmail) return true;
          return false;
        });
        if (matched) displayLocal = matched;
      }

      return {
        courseRunUuid: row.course_run_uuid,
        courseRunId: row.course_run_id || '',
        courseTitle: row.course_title || '',
        courseCode: row.course_code || '',
        classStatus: derivedStatus,
        classType: row.class_type || 'Physical',
        invitationPaused: !!row.invitation_paused,
        invitationRepliesBlocked: !!row.invitation_replies_blocked,
        sessionDate: compactToIso(row.session_date),
        startTime: row.start_time || '',
        endTime: row.end_time || '',
        dayNumber: parseInt(row.day_number, 10) || 1,
        sessionNumbers: Array.isArray(row.session_numbers)
          ? (row.session_numbers as any[]).filter((s) => s != null && s !== '').map((s) => String(s))
          : [],
        allSessionDates: allDatesMap.get(row.course_run_uuid) || [],
        numLearners: parseInt(row.num_learners || '0', 10),
        tpgTrainerName: row.tpg_assigned_trainer_name || '',
        tpgTrainerEmail: row.tpg_assigned_trainer_email || '',
        localTrainerName: displayLocal.name || (row.legacy_assigned_trainer_name || '').toString().trim(),
        localTrainerEmail: displayLocal.email,
        localTrainers: allLocalPairs,
        nextAvailableTrainer,
        nextAvailableTrainerEmail,
        latestInvitationStatus,
        approvedTrainers: trainerPool,
        trainerInvitations: perTrainerInvitations,
      };
    });

    // #64: Find course runs that are ongoing (start_date <= date <= end_date)
    // but have NO session on any date in this month window.
    // These are "ongoing but not running today" — shown in a separate section.
    const ongoingResult = await pool.query(
      `
      SELECT
        cr.id AS course_run_uuid,
        cr.course_run_id,
        c.title AS course_title,
        c.course_code,
        cr.class_status,
        cr.class_type,
        cr.start_date::text AS start_date,
        cr.end_date::text AS end_date,
        cr.tpg_assigned_trainer_name,
        cr.tpg_assigned_trainer_email,
        cr.assigned_trainer_name AS legacy_assigned_trainer_name,
        cr.assigned_trainer_email AS legacy_assigned_trainer_email,
        (SELECT COUNT(*) FROM enrollment e WHERE e.course_run_id = cr.id) AS num_learners,
        (SELECT COUNT(*) FROM course_session cs
         WHERE cs.course_run_id = cr.id AND cs.deleted = false
           AND cs.start_date IS NOT NULL AND cs.start_date <> '') AS total_sessions,
        (SELECT ARRAY_AGG(DISTINCT cs.start_date ORDER BY cs.start_date ASC)
         FROM course_session cs
         WHERE cs.course_run_id = cr.id AND cs.deleted = false
           AND cs.start_date IS NOT NULL AND cs.start_date <> '') AS session_dates
      FROM course_run cr
      JOIN course c ON c.id = cr.course_id
      WHERE cr.start_date <= $2::date
        AND cr.end_date >= $1::date
        AND cr.class_status NOT IN ('Cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM course_session cs
          WHERE cs.course_run_id = cr.id
            AND cs.deleted = false
            AND cs.start_date >= $3 AND cs.start_date <= $4
        )
      ORDER BY cr.start_date ASC, c.title ASC
      `,
      [monthStart, monthEnd, compactStart, compactEnd]
    );

    // Fetch Google Calendar titles for the month to tag ongoing events
    const calendarTitles = await getCalendarTitlesForMonth(monthStart, monthEnd);
    const hasCalendarData = calendarTitles.size > 0;

    const ongoingEvents = ongoingResult.rows.map((row: any) => {
      const title = (row.course_title || '').trim().toLowerCase();
      // Match if any calendar event title matches this course's title
      const inCalendar = hasCalendarData ? calendarTitles.has(title) : null;
      return {
        courseRunUuid: row.course_run_uuid,
        courseRunId: row.course_run_id,
        courseTitle: row.course_title,
        courseCode: row.course_code,
        classStatus: row.class_status || 'Pending',
        classType: row.class_type || 'Physical',
        startDate: row.start_date,
        endDate: row.end_date,
        tpgTrainerName: row.tpg_assigned_trainer_name || '',
        tpgTrainerEmail: row.tpg_assigned_trainer_email || '',
        localTrainerName: row.legacy_assigned_trainer_name || '',
        localTrainerEmail: row.legacy_assigned_trainer_email || '',
        numLearners: parseInt(row.num_learners || '0', 10),
        totalSessions: parseInt(row.total_sessions || '0', 10),
        sessionDates: (row.session_dates || []).map((d: string) => compactToIso(d)).filter(Boolean),
        inCalendar,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        events,
        totalCount: events.length,
        ongoingEvents,
      },
    });
  } catch (error) {
    console.error('Error fetching classes by date:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
