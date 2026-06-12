import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { normalizeTrainerName, splitTrainerList } from '@/lib/trainerInvitations';
import { triggerClassCalendarSync } from '@lib/calendar/triggerClassCalendarSync';

interface UpcomingClass {
  id: string;
  courseRunId: string;
  courseTitle: string;
  courseCode: string;
  classStatus: string;
  digitalAttendanceId: string;
  startDate: string;
  endDate: string;
  registrationOpeningDate?: string;
  registrationClosingDate?: string;
  assignedTrainerTpg: string;
  assignedTrainerTpgEmail: string;
  tpgSyncStatus: string | null;
  assignedTrainerLocal: string;
  assignedTrainerLocalEmail: string;
  nextAvailableTrainer: string;
  nextAvailableTrainerEmail: string;
  latestInvitationStatus: string;
  latestInvitationTrainer: string;
  numOfTrainee: number;
  trainersList?: string;
  courseType?: string;
  classType?: string;
  invitationPaused?: boolean;
  invitationRepliesBlocked?: boolean;
  trainerInCalendar?: boolean;
  virtualMeetingLink?: string;
  virtualMeetingHostLink?: string;
  virtualMeetingProvider?: string;
  virtualMeetingExternalId?: string;
  virtualMeetingStatus?: string;
  virtualMeetingSyncedAt?: string | null;
  modeOfTraining?: string;
  attendanceScore?: number | null;
}

const parseDDMMYYYY = (d: string) => {
  const p = d.split(/[/-]/);
  return `${p[2]}-${p[1]}-${p[0]}`;
};

const isValidDate = (d: any) => {
  if (typeof d !== 'string' || !/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(d)) return false;
  const p = d.split(/[/-]/);
  const day = parseInt(p[0], 10);
  const month = parseInt(p[1], 10);
  const year = parseInt(p[2], 10);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // PUT — Update class status and/or class type
  if (req.method === 'PUT') {
    try {
      const { id, class_status, class_type, virtual_meeting_link, virtual_meeting_host_link, virtual_meeting_provider } = req.body;
      if (!id) {
        return res.status(400).json({ success: false, error: 'id is required' });
      }

      const setClauses: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      if (class_status) {
        const validStatuses = ['Confirmed', 'Pending', 'Cancelled', 'Unconfirmed'];
        if (!validStatuses.includes(class_status)) {
          return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }
        setClauses.push(`class_status = $${paramIdx++}`);
        values.push(class_status);
      }

      if (class_type) {
        const validTypes = ['Physical', 'Virtual', 'Hybrid', 'External'];
        if (!validTypes.includes(class_type)) {
          return res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
        }
        // Ensure column exists
        await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS class_type TEXT DEFAULT \'Physical\'');
        setClauses.push(`class_type = $${paramIdx++}`);
        values.push(class_type);
      }

      if (virtual_meeting_link !== undefined) {
        await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS virtual_meeting_link TEXT');
        setClauses.push(`virtual_meeting_link = $${paramIdx++}`);
        values.push(virtual_meeting_link);
      }

      if (virtual_meeting_host_link !== undefined) {
        await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS virtual_meeting_host_link TEXT');
        setClauses.push(`virtual_meeting_host_link = $${paramIdx++}`);
        values.push(virtual_meeting_host_link);
      }

      if (virtual_meeting_provider !== undefined) {
        const validProviders = ['google_meet', 'zoom', 'teams'];
        if (virtual_meeting_provider && !validProviders.includes(virtual_meeting_provider)) {
          return res.status(400).json({ success: false, error: `Invalid virtual meeting provider. Must be one of: ${validProviders.join(', ')}` });
        }
        await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS virtual_meeting_provider TEXT');
        setClauses.push(`virtual_meeting_provider = $${paramIdx++}`);
        values.push(virtual_meeting_provider || null);
      }

      if (req.body.invitation_paused !== undefined) {
        await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS invitation_paused BOOLEAN DEFAULT false');
        setClauses.push(`invitation_paused = $${paramIdx++}`);
        values.push(!!req.body.invitation_paused);
      }

      if (req.body.invitation_replies_blocked !== undefined) {
        await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS invitation_replies_blocked BOOLEAN DEFAULT false');
        setClauses.push(`invitation_replies_blocked = $${paramIdx++}`);
        values.push(!!req.body.invitation_replies_blocked);
      }

      if (req.body.courseware_email_disabled !== undefined) {
        await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS courseware_email_disabled BOOLEAN DEFAULT false NOT NULL');
        setClauses.push(`courseware_email_disabled = $${paramIdx++}`);
        values.push(!!req.body.courseware_email_disabled);
      }

      if (setClauses.length === 0) {
        return res.status(400).json({ success: false, error: 'No fields to update' });
      }

      values.push(id);
      const result = await pool.query(
        `UPDATE course_run SET ${setClauses.join(', ')} WHERE id = $${paramIdx}
         RETURNING id, virtual_meeting_link, virtual_meeting_host_link, virtual_meeting_provider`,
        values
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Course run not found' });
      }

      // Calendar: a status change may require creating or removing the class's
      // events (Cancelled -> remove; Confirmed/Pending/Unconfirmed -> ensure if it
      // still has confirmed learners). Fire-and-forget; never blocks the response.
      if (class_status) triggerClassCalendarSync(id);

      return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error('Error updating course run:', err);
      return res.status(500).json({ success: false, error: 'Failed to update' });
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const hasInvitationTable = (
      await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'trainer_invitation' LIMIT 1`)
    ).rows.length > 0;
    // TPG column shows ONLY tpg_assigned_trainer_* (no fallback to assigned_trainer_*).
    // Rows without SSG-synced trainer data will render empty/N/A.
    const tpgNameExpr = `cr.tpg_assigned_trainer_name`;
    const tpgEmailExpr = `cr.tpg_assigned_trainer_email`;

    const {
      search,
      courseTitle,
      courseCode,
      courseRunId,
      trainer,
      classStatus,
      learnerFilter,
      trainerAssignmentFilter,
      thresholdDays: requestedThresholdDays,
      startDateFrom,
      endDateUntil,
      page = 0,
      limit = 20
    } = req.query;

    const pageNum = parseInt(page as string, 10) || 0;
    const limitNum = parseInt(limit as string, 10) || 20;
    const offset = pageNum * limitNum;

    let thresholdDays = 30;
    const parsedRequestThreshold = parseInt(String(requestedThresholdDays || ''), 10);
    if (!Number.isNaN(parsedRequestThreshold) && parsedRequestThreshold > 0) {
      thresholdDays = Math.min(parsedRequestThreshold, 730);
    } else {
      try {
        const thresholdResult = await pool.query(
          `SELECT upcoming_classes_threshold_days
           FROM training_provider
           LIMIT 1`
        );
        const rawThreshold = thresholdResult.rows[0]?.upcoming_classes_threshold_days;
        const parsedProviderThreshold = parseInt(String(rawThreshold || ''), 10);
        if (!Number.isNaN(parsedProviderThreshold) && parsedProviderThreshold > 0) {
          thresholdDays = Math.min(parsedProviderThreshold, 730);
        }
      } catch (error) {
        // Column may not exist yet; keep the screen default.
      }
    }

    // Ensure columns exist
    await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS class_type TEXT DEFAULT \'Physical\'');
    await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS invitation_paused BOOLEAN DEFAULT false');
    await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS invitation_replies_blocked BOOLEAN DEFAULT false');
    await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS trainer_in_calendar BOOLEAN');
    await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS tpg_sync_status TEXT');
    await pool.query('ALTER TABLE course_run ADD COLUMN IF NOT EXISTS courseware_email_disabled BOOLEAN DEFAULT false NOT NULL');

    const includeOngoing = req.query.includeOngoing === 'true';

    const params: any[] = [];
    let paramIndex = 1;
    const filters: string[] = [
      includeOngoing
        ? '(cr.start_date > CURRENT_DATE OR (cr.start_date <= CURRENT_DATE AND cr.end_date >= CURRENT_DATE))'
        : 'cr.start_date > CURRENT_DATE',
      `cr.start_date <= CURRENT_DATE + ($${paramIndex} * INTERVAL '1 day')`
    ];
    params.push(includeOngoing ? 365 : thresholdDays);
    paramIndex++;

    if (search && search !== '') {
      filters.push(`(
        c.title ILIKE $${paramIndex} OR
        c.course_code ILIKE $${paramIndex} OR
        cr.course_run_id ILIKE $${paramIndex} OR
        COALESCE(${tpgNameExpr}, '') ILIKE $${paramIndex} OR
        c.trainers_list ILIKE $${paramIndex} OR
        EXISTS (
          SELECT 1
          FROM course_run_trainer crt
          WHERE crt.course_run_id = cr.id AND crt.trainer_name ILIKE $${paramIndex}
        )
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (courseTitle && courseTitle !== '') {
      filters.push(`c.title ILIKE $${paramIndex}`);
      params.push(`%${courseTitle}%`);
      paramIndex++;
    }

    if (courseCode && courseCode !== '') {
      filters.push(`c.course_code ILIKE $${paramIndex}`);
      params.push(`%${courseCode}%`);
      paramIndex++;
    }

    if (courseRunId && courseRunId !== '') {
      filters.push(`cr.course_run_id ILIKE $${paramIndex}`);
      params.push(`%${courseRunId}%`);
      paramIndex++;
    }

    if (trainer && trainer !== '') {
      filters.push(`(
        COALESCE(${tpgNameExpr}, '') ILIKE $${paramIndex} OR
        c.trainers_list ILIKE $${paramIndex} OR
        EXISTS (
          SELECT 1
          FROM course_run_trainer crt
          WHERE crt.course_run_id = cr.id AND crt.trainer_name ILIKE $${paramIndex}
        )
      )`);
      params.push(`%${trainer}%`);
      paramIndex++;
    }

    const trainerAssignedSql = `(
      EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
      OR NULLIF(BTRIM(COALESCE(cr.assigned_trainer_name, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(cr.assigned_trainer_email, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(${tpgNameExpr}, '')), '') IS NOT NULL
      OR NULLIF(BTRIM(COALESCE(${tpgEmailExpr}, '')), '') IS NOT NULL
    )`;

    if (trainerAssignmentFilter === 'withTrainers') {
      filters.push(trainerAssignedSql);
    } else if (trainerAssignmentFilter === 'noTrainers') {
      filters.push(`NOT ${trainerAssignedSql}`);
    }

    if (classStatus === 'Confirmed' || classStatus === 'Pending' || classStatus === 'Cancelled') {
      filters.push(`cr.class_status = $${paramIndex}`);
      params.push(classStatus);
      paramIndex++;
    } else if (classStatus === 'ActiveOnly') {
      // Default Upcoming Classes status view: hide cancelled runs.
      // Learner presence is controlled separately by learnerFilter.
      filters.push(`cr.class_status IN ('Confirmed', 'Pending')`);
    }

    const classType = req.query.classType;
    if (classType === 'Physical' || classType === 'Virtual' || classType === 'Hybrid' || classType === 'External') {
      filters.push(`COALESCE(cr.class_type, 'Physical') = $${paramIndex}`);
      params.push(classType);
      paramIndex++;
    }

    const courseType = req.query.courseType;
    if (courseType === 'WSQ' || courseType === 'IBF' || courseType === 'Non-WSQ') {
      filters.push(`c.course_type = $${paramIndex}`);
      params.push(courseType);
      paramIndex++;
    }

    if (isValidDate(startDateFrom)) {
      filters.push(`cr.start_date::date >= $${paramIndex}`);
      params.push(parseDDMMYYYY(startDateFrom as string));
      paramIndex++;
    }

    if (isValidDate(endDateUntil)) {
      filters.push(`cr.end_date::date <= $${paramIndex}`);
      params.push(parseDDMMYYYY(endDateUntil as string));
      paramIndex++;
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    // Learner filter: 'noLearners' shows only 0-learner runs,
    // 'withLearners' requires ≥1, default 'all' shows everything.
    const havingClause = learnerFilter === 'noLearners'
      ? 'HAVING COUNT(e.id) = 0'
      : learnerFilter === 'withLearners'
        ? 'HAVING COUNT(e.id) >= 1'
        : '';
    const hasHaving = havingClause !== '';

    const baseQuery = `
      FROM course_run cr
      JOIN course c ON cr.course_id = c.id
      LEFT JOIN enrollment e ON e.course_run_id = cr.id
      ${whereClause}
    `;

    const mainResult = await pool.query(
      `
        SELECT
          cr.id,
          cr.course_run_id,
          c.title AS course_title,
          c.course_code,
          c.course_type,
          c.trainers_list,
          cr.class_status,
          cr.digital_attendance_id,
          cr.start_date,
          cr.end_date,
          cr.registration_opening_date,
          cr.registration_closing_date,
          cr.class_type,
          COALESCE(cr.invitation_paused, false) AS invitation_paused,
          COALESCE(cr.invitation_replies_blocked, false) AS invitation_replies_blocked,
          COALESCE(cr.courseware_email_disabled, false) AS courseware_email_disabled,
          cr.trainer_in_calendar,
          cr.virtual_meeting_link,
          cr.virtual_meeting_host_link,
          cr.virtual_meeting_provider,
          cr.virtual_meeting_external_id,
          cr.virtual_meeting_status,
          cr.virtual_meeting_synced_at,
          ${tpgNameExpr} AS assigned_trainer_tpg,
          ${tpgEmailExpr} AS assigned_trainer_tpg_email,
          cr.tpg_sync_status,
          cr.assigned_trainer_name AS legacy_assigned_trainer_name,
          COUNT(e.id) AS num_of_trainee
        ${baseQuery}
        GROUP BY
          cr.id,
          cr.course_run_id,
          c.title,
          c.course_code,
          c.course_type,
          c.trainers_list,
          cr.class_status,
          cr.digital_attendance_id,
          cr.start_date,
          cr.end_date,
          cr.registration_opening_date,
          cr.registration_closing_date,
          cr.class_type,
          cr.virtual_meeting_link,
          cr.virtual_meeting_host_link,
          cr.virtual_meeting_provider,
          cr.virtual_meeting_external_id,
          cr.virtual_meeting_status,
          cr.virtual_meeting_synced_at,
          ${tpgNameExpr},
          ${tpgEmailExpr},
          cr.tpg_sync_status,
          cr.assigned_trainer_name
        ${havingClause}
        ORDER BY cr.start_date ASC NULLS LAST, cr.end_date ASC NULLS LAST
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, limitNum, offset]
    );

    const countResult = await pool.query(
      hasHaving
        ? `SELECT COUNT(*) AS total_count FROM (
             SELECT cr.id FROM course_run cr
             JOIN course c ON cr.course_id = c.id
             LEFT JOIN enrollment e ON e.course_run_id = cr.id
             ${whereClause}
             GROUP BY cr.id
             ${havingClause}
           ) sub`
        : `SELECT COUNT(DISTINCT cr.id) AS total_count
           FROM course_run cr
           JOIN course c ON cr.course_id = c.id
           ${whereClause}`,
      params
    );

    const statsResult = await pool.query(
      hasHaving
        ? `
          SELECT
            COUNT(*) AS total_classes,
            COUNT(*) FILTER (
              WHERE EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = sub.id)
            ) AS total_confirmed_classes,
            COUNT(*) FILTER (
              WHERE NOT EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = sub.id)
            ) AS total_pending_classes,
            COUNT(*) FILTER (
              WHERE COALESCE(sub.tpg_name, '') <> ''
            ) AS total_assigned_tpg_classes,
            COUNT(*) FILTER (
              WHERE EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = sub.id)
            ) AS total_assigned_local_classes
          FROM (
            SELECT cr.id, ${tpgNameExpr} AS tpg_name
            FROM course_run cr
            JOIN course c ON cr.course_id = c.id
            LEFT JOIN enrollment e ON e.course_run_id = cr.id
            ${whereClause}
            GROUP BY cr.id, ${tpgNameExpr}
            ${havingClause}
          ) sub
        `
        : `
          SELECT
            COUNT(DISTINCT cr.id) AS total_classes,
            COUNT(DISTINCT cr.id) FILTER (
              WHERE EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
            ) AS total_confirmed_classes,
            COUNT(DISTINCT cr.id) FILTER (
              WHERE NOT EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
            ) AS total_pending_classes,
            COUNT(DISTINCT cr.id) FILTER (
              WHERE COALESCE(${tpgNameExpr}, '') <> ''
            ) AS total_assigned_tpg_classes,
            COUNT(DISTINCT cr.id) FILTER (
              WHERE EXISTS (SELECT 1 FROM course_run_trainer crt WHERE crt.course_run_id = cr.id)
            ) AS total_assigned_local_classes
          FROM course_run cr
          JOIN course c ON cr.course_id = c.id
          ${whereClause}
        `,
      params
    );

    const rows = mainResult.rows;
    const courseRunIds = rows.map((row) => row.id);

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

    // Build email-based trainer identity map.
    // Problem: local assigned trainer may have a different name than the approved list
    // (e.g. "Dr. Muhammed Siraj" locally vs "Dr. Siraj Mohammad" in approved list).
    // Solution: use email as the reliable identifier via app_user table.
    //   - nameToEmail: normalized trainer name -> email
    //   - emailToNames: email -> set of all known normalized names for that person
    const nameToEmail = new Map<string, string>();
    const emailToNames = new Map<string, Set<string>>();
    {
      // Collect all approved trainer names and all local trainer emails
      const approvedNames = new Set<string>();
      for (const row of rows) {
        for (const name of splitTrainerList(row.trainers_list)) {
          approvedNames.add(name);
        }
      }
      const localEmails = new Set<string>();
      for (const [, data] of localTrainerMap) {
        for (const e of data.emails) {
          if (e) localEmails.add(e.toLowerCase().trim());
        }
      }
      // Single query: fetch app_user rows for approved trainer names OR local trainer emails
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

    const upcomingClasses: UpcomingClass[] = rows.map((row) => {
      const trainerPool = splitTrainerList(row.trainers_list);
      const normalizedTrainerPool = trainerPool.map((n) => normalizeTrainerName(n));
      const localTrainerData = localTrainerMap.get(row.id) || { names: [], emails: [] };
      const allLocalPairs = localTrainerData.names
        .map((name, index) => ({ name, email: localTrainerData.emails[index] || '' }));

      // Build set of ALL normalized names that belong to locally assigned trainers
      // by resolving each local trainer's email to all their known names
      const localAssignedAllNames = new Set<string>();
      const localAssignedEmails = new Set<string>();
      for (const pair of allLocalPairs) {
        const normName = normalizeTrainerName(pair.name);
        localAssignedAllNames.add(normName);
        const email = (pair.email || '').toLowerCase().trim();
        if (email) {
          localAssignedEmails.add(email);
          // Add all names associated with this email (handles name mismatches)
          const aliases = emailToNames.get(email);
          if (aliases) {
            for (const alias of aliases) localAssignedAllNames.add(alias);
          }
        }
        // Also resolve via name -> email -> all names
        const resolvedEmail = nameToEmail.get(normName);
        if (resolvedEmail) {
          localAssignedEmails.add(resolvedEmail);
          const aliases = emailToNames.get(resolvedEmail);
          if (aliases) {
            for (const alias of aliases) localAssignedAllNames.add(alias);
          }
        }
      }

      const invitations = invitationMap.get(row.id) || [];

      // Check if an approved trainer is locally assigned (by any known name, email, or word overlap)
      const isLocallyAssigned = (approvedNormalized: string): boolean => {
        if (localAssignedAllNames.has(approvedNormalized)) return true;
        // Check via the approved trainer's email
        const approvedEmail = nameToEmail.get(approvedNormalized);
        if (approvedEmail && localAssignedEmails.has(approvedEmail)) return true;
        // Fallback: word-overlap matching for names that differ but refer to the same person
        // e.g. "Dr. Siraj Mohammad" vs "Dr. Muhammed Siraj" — share significant name words
        const approvedWords = new Set(approvedNormalized.split(/\s+/).filter(w => w.length > 2));
        if (approvedWords.size > 0) {
          for (const localName of localAssignedAllNames) {
            const localWords = localName.split(/\s+/).filter(w => w.length > 2);
            const shared = localWords.filter(w => approvedWords.has(w));
            // If at least 2 significant words overlap (or 1 if name has only 1 word), match
            if (shared.length >= 2 || (shared.length >= 1 && (approvedWords.size <= 1 || localWords.length <= 1))) {
              return true;
            }
          }
        }
        return false;
      };

      let nextAvailableTrainer = '';
      let nextAvailableTrainerEmail = '';
      let latestInvitationStatus = invitations[0]?.status || '';
      let latestInvitationTrainer = invitations[0]?.trainer_name || '';

      // Find index of last assigned trainer in the approved list
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
          latestInvitationTrainer = invitation.trainer_name || trainerName;
        } else {
          latestInvitationStatus = '';
          latestInvitationTrainer = '';
        }
        break;
      }

      // Build per-trainer latest invitation status for the Approved Trainers panel.
      // Keyed by normalized trainer name → array with latest invitation row only.
      // Uses array format to match classes-by-date shape (ClassManagementViews reads [0]).
      const perTrainerInvitation: Record<string, Array<{ status: string; sent_at: string; responded_at: string | null }>> = {};
      for (const inv of invitations) {
        const norm = normalizeTrainerName(inv.trainer_name);
        if (!perTrainerInvitation[norm]) {
          perTrainerInvitation[norm] = [{
            status: inv.status,
            sent_at: inv.created_at,
            responded_at: inv.responded_at || null,
          }];
        }
      }

      // Derive class status: Confirmed if ANY trainer signal is present
      // (junction-table local trainer, legacy course_run.assigned_trainer_name,
      // or tpg_assigned_trainer_name), else Pending. 'Cancelled' is sticky.
      //
      // History: this derivation used to only check the junction table, so
      // rows with a TPG-only trainer OR a legacy (pre-junction) local trainer
      // would be stomped back to Pending on every page load, undoing both
      // the auto-confirm write-paths and the backfill migration.
      // Helper to check if a trainer name has a pending or declined invitation
      const hasUnacceptedInvitation = (name: string) => {
        if (!name) return false;
        const norm = normalizeTrainerName(name);
        const inv = invitations.find(i => normalizeTrainerName(i.trainer_name) === norm);
        return inv ? (inv.status === 'pending' || inv.status === 'declined') : false;
      };

      // Filter out TPG and Legacy trainers if they have an unaccepted invitation
      const rawTpgTrainer = (row.assigned_trainer_tpg || '').toString().trim();
      const rawLegacyTrainer = (row.legacy_assigned_trainer_name || '').toString().trim();
      
      const effectiveTpgTrainer = hasUnacceptedInvitation(rawTpgTrainer) ? '' : rawTpgTrainer;
      const effectiveLegacyTrainer = hasUnacceptedInvitation(rawLegacyTrainer) ? '' : rawLegacyTrainer;

      const hasLocalTrainer = !!(allLocalPairs[0]?.name);
      const hasLegacyLocalTrainer = !!effectiveLegacyTrainer;
      const hasTpgTrainer = !!effectiveTpgTrainer;
      const hasLearners = Number(row.num_of_trainee) > 0;
      const derivedStatus = (row.class_status === 'Cancelled' || row.class_status === 'Unconfirmed' || row.class_status === 'Confirmed')
        ? row.class_status
        : ((hasLocalTrainer || hasLegacyLocalTrainer || hasTpgTrainer) && hasLearners ? 'Confirmed' : 'Pending');

      // Persist to DB if status changed (skipped automatically when already Cancelled)
      if (row.class_status !== derivedStatus) {
        pool.query(`UPDATE course_run SET class_status = $1, updated_at = NOW() WHERE id = $2`, [derivedStatus, row.id]).catch(() => {});
      }

      return {
        id: row.id,
        courseRunId: row.course_run_id,
        courseTitle: row.course_title,
        courseCode: row.course_code,
        classStatus: derivedStatus,
        digitalAttendanceId: row.digital_attendance_id || '',
        startDate: row.start_date,
        endDate: row.end_date,
        registrationOpeningDate: row.registration_opening_date,
        registrationClosingDate: row.registration_closing_date,
        assignedTrainerTpg: rawTpgTrainer,
        assignedTrainerTpgEmail: row.assigned_trainer_tpg_email || '',
        tpgSyncStatus: row.tpg_sync_status || null,
        assignedTrainerLocal: allLocalPairs[0]?.name || effectiveLegacyTrainer,
        assignedTrainerLocalEmail: allLocalPairs[0]?.email || '',
        nextAvailableTrainer,
        nextAvailableTrainerEmail,
        latestInvitationStatus,
        latestInvitationTrainer,
        numOfTrainee: parseInt(row.num_of_trainee || '0', 10),
        trainersList: row.trainers_list || '',
        trainerInvitations: perTrainerInvitation,
        courseType: row.course_type || '',
        classType: row.class_type || 'Physical',
        invitationPaused: !!row.invitation_paused,
        invitationRepliesBlocked: !!row.invitation_replies_blocked,
        coursewareEmailDisabled: !!row.courseware_email_disabled,
        trainerInCalendar: row.trainer_in_calendar,
        virtualMeetingLink: row.virtual_meeting_link || '',
        virtualMeetingHostLink: row.virtual_meeting_host_link || '',
        virtualMeetingProvider: row.virtual_meeting_provider || '',
        virtualMeetingExternalId: row.virtual_meeting_external_id || '',
        virtualMeetingStatus: row.virtual_meeting_status || '',
        virtualMeetingSyncedAt: row.virtual_meeting_synced_at || null,
        modeOfTraining: '',
        attendanceScore: null as number | null,
      };
    });

    // Fetch mode_of_training and attendance scores for all course runs
    if (courseRunIds.length > 0) {
      // Mode of training from first session
      const modeResult = await pool.query(`
        SELECT DISTINCT ON (course_run_id) course_run_id, mode_of_training
        FROM course_session
        WHERE course_run_id = ANY($1::uuid[]) AND deleted = false
        ORDER BY course_run_id, COALESCE(start_date, '9999-12-31') ASC, session_number ASC
      `, [courseRunIds]);
      const modeMap = new Map(modeResult.rows.map((r: any) => [r.course_run_id, r.mode_of_training || '']));

      // Attendance scores: average of is_present across all sessions per course run
      const attendanceResult = await pool.query(`
        SELECT
          cs.course_run_id,
          ROUND(AVG(CASE WHEN ca.is_present THEN 100.0 ELSE 0.0 END))::int AS avg_score
        FROM course_attendance ca
        JOIN course_session cs ON ca.session_id = cs.id
        WHERE cs.course_run_id = ANY($1::uuid[]) AND cs.deleted = false
        GROUP BY cs.course_run_id
      `, [courseRunIds]);
      const attendanceMap = new Map(attendanceResult.rows.map((r: any) => [r.course_run_id, parseInt(r.avg_score, 10)]));

      for (const cls of upcomingClasses) {
        cls.modeOfTraining = modeMap.get(cls.id) || '';
        cls.attendanceScore = attendanceMap.get(cls.id) ?? null;
      }
    }

    const stats = statsResult.rows[0] || {};
    const totalCount = parseInt(countResult.rows[0]?.total_count || '0', 10);

    res.status(200).json({
      success: true,
      data: {
        classes: upcomingClasses,
        totalCount,
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        stats: {
          totalClasses: parseInt(stats.total_classes || '0', 10),
          totalConfirmedClasses: parseInt(stats.total_confirmed_classes || '0', 10),
          totalPendingClasses: parseInt(stats.total_pending_classes || '0', 10),
          totalAssignedTpgClasses: parseInt(stats.total_assigned_tpg_classes || '0', 10),
          totalAssignedLocalClasses: parseInt(stats.total_assigned_local_classes || '0', 10),
        }
      }
    });
  } catch (error) {
    console.error('Error fetching upcoming classes:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
