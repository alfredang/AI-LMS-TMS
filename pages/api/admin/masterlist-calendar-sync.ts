import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../lib/db';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';
import { getLocalYMD } from '../../../lib/dateHelpers';

type ClassTabType =
  | 'virtual'
  | 'evening'
  | 'external'
  | 'woodsSquare'
  | 'reschedule'
  | 'cancelled'
  | 'bukitTimah';

/**
 * Detect which MasterList tab an event belongs to. Order matters — title tags
 * win over time, time wins over location, location wins over default.
 *
 * Rules (first match):
 *  1. [VIRTUAL] / "Virtual Class/Classroom" in title  → virtual
 *  2. [EXTERNAL] in title                              → external
 *  3. Start time ≥ 18:00 SGT                           → evening
 *  4. event.location contains "Bukit Timah"            → bukitTimah
 *  5. Otherwise                                        → woodsSquare (default)
 */
function detectTab(
  title: string,
  startDateTime: string | null | undefined,
  location: string | null | undefined,
): ClassTabType {
  const upper = (title || '').toUpperCase();
  if (/\[VIRTUAL\]/.test(upper) || /VIRTUAL\s*(CLASS|CLASSROOM)/i.test(title)) return 'virtual';
  if (/\[EXTERNAL\]/.test(upper)) return 'external';
  if (startDateTime) {
    const d = new Date(startDateTime);
    const sgtHour = (d.getUTCHours() + 8) % 24;
    if (sgtHour >= 18) return 'evening';
  }
  const loc = (location || '').toLowerCase();
  if (loc.includes('bukit timah')) return 'bukitTimah';
  return 'woodsSquare';
}

/**
 * Build the entry_date value stored in the DB (ISO format, parsed by DateRangeCell).
 *
 * - 1 date            →  "YYYY-MM-DD"          (single ISO date)
 * - consecutive dates →  "YYYY-MM-DD~YYYY-MM-DD"  (range, DateRangeCell native)
 * - non-consecutive   →  "YYYY-MM-DD,YYYY-MM-DD,..."  (comma-separated ISO dates)
 *
 * DateRangeCell in the UI handles the display formatting to DD/MM/YYYY.
 */
function buildEntryDate(sortedDates: string[]): string {
  if (sortedDates.length === 0) return '';
  if (sortedDates.length === 1) return sortedDates[0];

  let consecutive = true;
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1] + 'T00:00:00Z');
    const curr = new Date(sortedDates[i] + 'T00:00:00Z');
    if ((curr.getTime() - prev.getTime()) / 86_400_000 !== 1) {
      consecutive = false;
      break;
    }
  }

  return consecutive
    ? `${sortedDates[0]}~${sortedDates[sortedDates.length - 1]}`
    : sortedDates.join(',');
}

/**
 * Strip bracket tags (e.g. [VIRTUAL], [WSQ]), leading asterisks, and any leading
 * "Day N -" / "ONE DAY -" prefixes from a calendar event title so the masterlist
 * title matches the raw course name from Google Calendar.
 */
function stripTitle(title: string): string {
  return (title || '')
    .replace(/\[(?:WSQ|IBF|VIRTUAL|EXTERNAL|HYBRID)\]\s*/gi, '')  // strip [TAG] brackets
    .replace(/^\*\s*/, '')                                          // strip leading *
    // Strip "Day N -" / "ONE DAY -" prefix — covers hyphens, en-dash, em-dash,
    // with or without surrounding spaces, and optional space between "Day" and number.
    .replace(/^(Day\s*\d+|ONE\s*DAY)\s*[-–—\u2014\u2013]\s*/i, '')
    .trim();
}

/**
 * Strip the recurrence instance suffix `_YYYYMMDDTHHMMSSZ` from a Google
 * Calendar event ID. Two instances of the same recurring event resolve to
 * the same base; two different recurring events resolve to different bases.
 *
 * Used to keep two events that share a normalised title but represent
 * different course runs (e.g. one recurring PL-200 series + a separate
 * "Day N - PL-200" series) in separate buckets in the masterlist.
 */
function extractEvtIdBase(evtId: string): string {
  return (evtId || '').replace(/_\d{8}T\d{6}Z$/, '');
}

/**
 * Reverse of the `${evtId}_${listDate}` cal_id format used by the sync's
 * INSERT. Strips the listDate suffix first, then the recurrence-instance
 * suffix, leaving just the event ID base.
 */
function calIdToBase(calId: string | null | undefined): string {
  if (!calId) return '';
  return extractEvtIdBase(calId.replace(/_\d{4}-\d{2}-\d{2}$/, ''));
}

async function getCalendarClient() {
  const credentials = await getGoogleCredentials(pool);
  const tpRes = await pool.query(
    'SELECT google_calendar_url, sync_google_calendar FROM training_provider LIMIT 1',
  );
  const tpRow = tpRes.rows[0];

  if (!tpRow?.sync_google_calendar) {
    throw new Error('CALENDAR_DISABLED');
  }

  const calUrl = tpRow.google_calendar_url || '';
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
    credentials.clientId,
    credentials.clientSecret,
    'https://developers.google.com/oauthplayground',
  );
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  return { calendar: google.calendar({ version: 'v3', auth: oauth2Client }), calendarId };
}

/**
 * POST /api/admin/masterlist-calendar-sync
 *
 * Body: (empty) — syncs the full calendar across a rolling window
 *   (1 Jan of the previous year → 31 Dec of the year after next)
 *
 * Fetches all WSQ/IBF calendar events and auto-creates any that don't already
 * exist in masterlist_table. Safe to call repeatedly — idempotent.
 *
 * Dedup logic (two-pass):
 *   1. Exact match by calendar_event_id (fast path — original sync row not yet edited)
 *   2. Fuzzy match by list_date + class_type + normalized title (handles rows re-saved via UI)
 *
 * Uses pagination to retrieve up to 2 500 events per page (Google Calendar max).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // force mode removed — full-table wipe was a destructive risk with no auth gate

  // Ensure schema is up to date and remove any existing duplicate class blocks.
  // Runs on every sync call so stale duplicates are always cleaned up automatically.
  try {
    await pool.query(
      `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS calendar_event_id text`,
    );
    // Marks rows whose source Google Calendar event no longer exists (or has
    // been retitled/moved so the dedup key no longer matches). Rather than
    // silently deleting these — which would lose any trainee data the admin
    // typed into the row — we flag them so the UI can surface an "Not in
    // Google Calendar" warning and let the admin decide whether to delete.
    await pool.query(
      `ALTER TABLE public.masterlist_table ADD COLUMN IF NOT EXISTS calendar_orphaned boolean DEFAULT false`,
    );

    // ── Data repair: cal_id ↔ list_date consistency ──────────────────────────
    // calendar_event_id is stored as "${evtId}_${listDate}". If the trailing
    // date no longer matches list_date, the row got there through a buggy
    // propagation (the ON CONFLICT (calendar_event_id) DO UPDATE clause in
    // POST /api/admin/masterlist migrated list_date when a propagated row
    // collided with an existing cal_id). Clear the cal_id so the row becomes
    // a manual entry; the same sync's insert pass below will then re-create
    // the original calendar-synced row on the correct day.
    try {
      const repairRes = await pool.query(`
        UPDATE public.masterlist_table
        SET calendar_event_id = NULL,
            calendar_orphaned = false,
            updated_at        = now()
        WHERE calendar_event_id IS NOT NULL
          AND substring(calendar_event_id from '_(\\d{4}-\\d{2}-\\d{2})$') IS NOT NULL
          AND substring(calendar_event_id from '_(\\d{4}-\\d{2}-\\d{2})$') <> list_date::text
      `);
      if (repairRes.rowCount && repairRes.rowCount > 0) {
        console.log(`[masterlist-calendar-sync] repaired ${repairRes.rowCount} rows with cross-date cal_ids`);
      }
    } catch (e) {
      console.error('[masterlist-calendar-sync] cal_id repair error:', e);
    }
    await pool.query(`DROP INDEX IF EXISTS idx_masterlist_calendar_event_id`);
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_masterlist_calendar_event_id_unique
       ON public.masterlist_table(calendar_event_id)
       WHERE calendar_event_id IS NOT NULL`,
    );

    // ── Step A: Normalise existing titles ─────────────────────────────────────
    // Strip any "Day N -" / "ONE DAY -" prefix that was previously added by the
    // sync so that old rows match the new title format (raw Google Calendar title).
    // Must run BEFORE the unique index is touched — updating titles could create
    // temporary duplicates that would violate an existing unique index.
    await pool.query(`DROP INDEX IF EXISTS idx_masterlist_cal_title_date_unique`);
    await pool.query(`
      UPDATE public.masterlist_table
      SET course_title = REGEXP_REPLACE(
            course_title,
            '^(Day\\s*\\d+|ONE\\s*DAY)\\s*[-–—]\\s*',
            '',
            'i'
          )
      WHERE course_title ~ '^(Day\\s*\\d+|ONE\\s*DAY)\\s*[-–—]'
    `);

    // ── Step B: Remove duplicate class blocks ─────────────────────────────────
    // Legacy cleanup for rows from before evtIdBase-aware dedup landed: two
    // class blocks with the same (date, type, title, evtIdBase) are genuine
    // duplicates of the same course run and should collapse to one.
    //
    // CRITICAL: evtIdBase MUST be part of the dedup key. Two events with the
    // same stripped title but different evtIdBases (e.g. a "WSQ - PL-200"
    // recurring series + a "Day 4 - WSQ - PL-200" recurring series running
    // on the same day) are distinct course runs and must each keep their row.
    //
    // Keep the class_id with real trainee data; if tied, keep oldest.
    //
    // Safety guard: only run the dedup DELETE when there are actual duplicates.
    const dedupCheck = await pool.query(`
      WITH class_info AS (
        SELECT
          class_id,
          list_date,
          class_type,
          LOWER(TRIM(COALESCE(course_title, ''))) AS norm_title,
          regexp_replace(
            regexp_replace(
              MAX(calendar_event_id),
              '_\\d{4}-\\d{2}-\\d{2}$',
              ''
            ),
            '_\\d{8}T\\d{6}Z$',
            ''
          ) AS evt_id_base,
          BOOL_OR(name IS NOT NULL AND TRIM(name) <> '')  AS has_data,
          MIN(created_at)                                  AS earliest
        FROM public.masterlist_table
        WHERE calendar_event_id IS NOT NULL
        GROUP BY class_id, list_date, class_type,
          LOWER(TRIM(COALESCE(course_title, '')))
      ),
      keepers AS (
        SELECT DISTINCT ON (list_date, class_type, norm_title, evt_id_base)
          class_id
        FROM class_info
        ORDER BY list_date, class_type, norm_title, evt_id_base,
          has_data DESC, earliest ASC
      )
      SELECT
        (SELECT COUNT(DISTINCT class_id) FROM public.masterlist_table WHERE calendar_event_id IS NOT NULL) AS total,
        (SELECT COUNT(*) FROM keepers) AS keeping
    `);
    const { total, keeping } = dedupCheck.rows[0] as { total: string; keeping: string };
    const totalN   = parseInt(total,   10);
    const keepingN = parseInt(keeping, 10);
    if (keepingN > 0 && totalN > keepingN) {
      await pool.query(`
        WITH class_info AS (
          SELECT
            class_id,
            list_date,
            class_type,
            LOWER(TRIM(COALESCE(course_title, ''))) AS norm_title,
            regexp_replace(
              regexp_replace(
                MAX(calendar_event_id),
                '_\\d{4}-\\d{2}-\\d{2}$',
                ''
              ),
              '_\\d{8}T\\d{6}Z$',
              ''
            ) AS evt_id_base,
            BOOL_OR(name IS NOT NULL AND TRIM(name) <> '')  AS has_data,
            MIN(created_at)                                  AS earliest
          FROM public.masterlist_table
          WHERE calendar_event_id IS NOT NULL
          GROUP BY class_id, list_date, class_type,
            LOWER(TRIM(COALESCE(course_title, '')))
        ),
        keepers AS (
          SELECT DISTINCT ON (list_date, class_type, norm_title, evt_id_base)
            class_id
          FROM class_info
          ORDER BY list_date, class_type, norm_title, evt_id_base,
            has_data DESC, earliest ASC
        )
        DELETE FROM public.masterlist_table
        WHERE calendar_event_id IS NOT NULL
          AND class_id NOT IN (SELECT class_id FROM keepers)
      `);
    }

    // ── Step C: Title+date unique index — DROPPED, do not recreate ───────────
    // This used to enforce "no two synced rows with the same (date, type,
    // title)". That's now wrong: two different recurring events can share a
    // stripped title (e.g. PL-200 base series vs Day-N PL-200 series) and
    // each deserves its own row. The cal_id unique index above already
    // prevents true duplicates (same evtId on same listDate).
    await pool.query(`DROP INDEX IF EXISTS idx_masterlist_cal_title_date_unique`);
  } catch (e) {
    console.error('[masterlist-calendar-sync] migrate error:', e);
  }

  try {
    let calendar: ReturnType<typeof google.calendar>;
    let calendarId: string;

    try {
      const client = await getCalendarClient();
      calendar = client.calendar;
      calendarId = client.calendarId;
    } catch (e: any) {
      if (e.message === 'CALENDAR_DISABLED') {
        // Google Calendar sync not enabled — silently skip
        return res.status(200).json({ success: true, added: 0, skipped: 0, disabled: true });
      }
      throw e;
    }

    // Rolling window: 1 Jan of last year → 31 Dec of the year after next
    // This covers the entire visible calendar range in one pass.
    const now = new Date();
    const fromYear = now.getFullYear() - 1;
    const toYear = now.getFullYear() + 2;
    const timeMin = new Date(`${fromYear}-01-01T00:00:00+08:00`).toISOString();
    const timeMax = new Date(`${toYear}-01-01T00:00:00+08:00`).toISOString();

    // Paginate through all events (Google Calendar returns max 2500 per page)
    const allItems: any[] = [];
    let pageToken: string | undefined;
    do {
      const eventsRes: any = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 2500,
        ...(pageToken ? { pageToken } : {}),
      });
      allItems.push(...(eventsRes.data.items || []));
      pageToken = eventsRes.data.nextPageToken || undefined;
    } while (pageToken);

    // Use all calendar events — this is a dedicated training calendar so every
    // event is a class. Filter out events with no title or that are cancelled.
    const events = allItems.filter(e => (e.summary || '').trim() && e.status !== 'cancelled');

    if (events.length === 0) {
      return res.status(200).json({ success: true, added: 0, skipped: 0 });
    }

    // Pre-load ALL existing dedup keys in bulk (avoids per-event DB round trips)
    const existingIdsRes = await pool.query(
      `SELECT calendar_event_id FROM public.masterlist_table WHERE calendar_event_id IS NOT NULL`,
    );
    const existingEventIds = new Set<string>(
      existingIdsRes.rows.map((r: any) => r.calendar_event_id),
    );

    // Also pre-load existing (list_date, class_type, lower title, evtIdBase)
    // combos for fuzzy dedup. evtIdBase is included so that two events with
    // the same title but different recurring-event bases each get their own
    // class block. Manual rows (no cal_id) carry an empty evtIdBase and
    // therefore don't collide with sync-origin rows at the same title.
    const existingTitlesRes = await pool.query(
      `SELECT list_date::text, class_type, LOWER(TRIM(course_title)) AS title, calendar_event_id
       FROM public.masterlist_table
       WHERE course_title IS NOT NULL`,
    );
    const existingTitleKeys = new Set<string>(
      existingTitlesRes.rows.map(
        (r: any) => `${r.list_date}|${r.class_type}|${r.title}|${calIdToBase(r.calendar_event_id)}`,
      ),
    );

    // ── Step 1: Expand all events into flat (date, meta) entries ─────────────
    // A single Google Calendar event can span multiple days; separate calendar
    // events can also represent individual days of the same multi-day course.
    // We need to handle both cases before we can assign Day N / ONE DAY labels.

    interface FlatEntry {
      listDate: string;
      evtId: string;
      // evtId stripped of the `_YYYYMMDDTHHMMSSZ` recurrence-instance suffix.
      // Two events with the same normalised title but different evtIdBases
      // are genuinely different course runs (e.g. two separate recurring
      // PL-200 series running concurrently) and must not be deduplicated.
      evtIdBase: string;
      rawTitle: string;
      baseTitle: string;
      classType: ClassTabType;
      // Raw Google Calendar event.location string. Surfaced into the
      // masterlist venue field for external classes (where the venue is
      // meaningful) — Woods Square / Bukit Timah have the venue implied by
      // their tab, so we don't clutter their rows with it.
      location: string;
    }

    const flatEntries: FlatEntry[] = [];

    for (const evt of events) {
      const rawTitle = evt.summary || '';
      const baseTitle = stripTitle(rawTitle);
      const classType = detectTab(rawTitle, evt.start?.dateTime, evt.location);
      const evtId = evt.id || '';
      const location = (evt.location || '').trim();

      // Resolve start date in SGT. getLocalYMD already formats in
      // Asia/Singapore, so we just pass the parsed Date directly — the
      // earlier `+ 8h` shift here doubled the conversion and pushed any
      // end time after 4 PM SGT into the next SGT day.
      let startDate: string;
      if (evt.start?.dateTime) {
        startDate = getLocalYMD(new Date(evt.start.dateTime));
      } else if (evt.start?.date) {
        startDate = evt.start.date;
      } else {
        continue; // no date — skip
      }

      // Resolve end date in SGT (inclusive)
      let endDate: string = startDate;
      if (evt.end?.dateTime) {
        endDate = getLocalYMD(new Date(evt.end.dateTime));
      } else if (evt.end?.date) {
        // Google Calendar all-day end is exclusive → subtract 1 day
        const d = new Date(evt.end.date + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        endDate = getLocalYMD(d);
      }

      // Expand single multi-day event (e.g. Mon–Fri block) into daily entries
      const cur = new Date(startDate + 'T00:00:00Z');
      const end = new Date(endDate + 'T00:00:00Z');
      const evtIdBase = extractEvtIdBase(evtId);
      while (cur <= end) {
        flatEntries.push({
          listDate: getLocalYMD(cur),
          evtId,
          evtIdBase,
          rawTitle,
          baseTitle,
          classType,
          location,
        });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    // ── Step 1b: Deduplicate flat entries ─────────────────────────────────────
    // Within ONE recurring event (same evtIdBase), drop redundant entries on
    // the same date — e.g. two instances of the same recurring event that
    // happen to surface twice through the API on the same day.
    //
    // Across DIFFERENT events (different evtIdBases) that happen to share a
    // normalised title, KEEP BOTH. Example: a recurring "WSQ - PL-200" series
    // and a separate "Day N - WSQ - PL-200" series both running on May 21 are
    // two distinct course runs that need two class blocks in the masterlist.
    const seenFlatKeys = new Set<string>();
    const dedupedFlatEntries: FlatEntry[] = [];
    for (const entry of flatEntries) {
      const normBase = entry.baseTitle
        .replace(/^(Day\s+\d+|ONE\s*DAY)\s*[-–]\s*/i, '')
        .toLowerCase()
        .trim();
      const flatKey = `${entry.listDate}|${entry.classType}|${entry.evtIdBase}|${normBase}`;
      if (seenFlatKeys.has(flatKey)) continue;
      seenFlatKeys.add(flatKey);
      dedupedFlatEntries.push(entry);
    }

    // ── Step 2: Group entries by event identity + normalised base title ──────
    // Strip any existing "Day N -" or "ONE DAY -" prefix from the title
    // portion of the key so that calendar events like "Day 1 - Course X" and
    // "Day 2 - Course X" cluster into the same run (they share evtIdBase
    // because they're instances of the same recurring event).
    //
    // Including evtIdBase keeps two different recurring events with the
    // same normalised title apart, so each becomes its own class block.
    const groupsByTitle = new Map<string, FlatEntry[]>();
    for (const entry of dedupedFlatEntries) {
      const titleKey = entry.baseTitle
        .replace(/^(Day\s+\d+|ONE\s*DAY)\s*[-–]\s*/i, '')
        .toLowerCase()
        .trim();
      const key = `${entry.evtIdBase}|${titleKey}`;
      if (!groupsByTitle.has(key)) groupsByTitle.set(key, []);
      groupsByTitle.get(key)!.push(entry);
    }

    // ── Step 3: Within each title group, cluster into course runs ─────────────
    // A new run begins when the gap between consecutive dates exceeds 4 days
    // (covers Mon–Fri courses where the weekend gap is only 2–3 days, but a
    // new run the following week is at least 5 days away).
    const MAX_GAP_DAYS = 4;

    interface CourseRun {
      entries: FlatEntry[];
      classDateRange: string; // "" for single-day runs
    }

    const allRuns: CourseRun[] = [];

    for (const [, group] of groupsByTitle) {
      // Sort by date ascending
      group.sort((a, b) => a.listDate.localeCompare(b.listDate));

      // Cluster
      const clusters: FlatEntry[][] = [];
      let current: FlatEntry[] = [];
      for (const entry of group) {
        if (current.length === 0) {
          current.push(entry);
        } else {
          const lastMs = new Date(current[current.length - 1].listDate).getTime();
          const thisMs = new Date(entry.listDate).getTime();
          const gapDays = (thisMs - lastMs) / 86_400_000;
          if (gapDays <= MAX_GAP_DAYS) {
            current.push(entry);
          } else {
            clusters.push(current);
            current = [entry];
          }
        }
      }
      if (current.length > 0) clusters.push(current);

      for (const cluster of clusters) {
        const classDateRange =
          cluster.length > 1
            ? `${cluster[0].listDate}~${cluster[cluster.length - 1].listDate}`
            : '';
        allRuns.push({ entries: cluster, classDateRange });
      }
    }

    // ── Step 4: Assign titles and insert ─────────────────────────────────────
    // Pre-dedup across all runs: if two runs produce the same (listDate, classType, title),
    // keep only the first. This handles duplicate Google Calendar events (e.g. a recurring
    // occurrence + a standalone event with the same title on the same day).
    const seenInsertKeys = new Set<string>();
    let added = 0;
    let skipped = 0;

    for (const { entries: run, classDateRange } of allRuns) {
      const runDates = run.map(e => e.listDate); // already sorted ascending
      const entryDate = buildEntryDate(runDates);

      for (let i = 0; i < run.length; i++) {
        const { listDate, evtId, evtIdBase, baseTitle, classType, location } = run[i];

        // Use the stripped Google Calendar title directly — no "Day N -" / "ONE DAY -"
        // prefix is added. The entry_date column carries the actual class date(s).
        const title = baseTitle;

        // Unique dedup key: combine event ID with date so that both shared-ID
        // (multi-day single event) and separate-event scenarios are handled.
        const uniqueKey = evtId ? `${evtId}_${listDate}` : '';

        // Dedup pass 1: exact calendar_event_id match
        if (uniqueKey && existingEventIds.has(uniqueKey)) {
          skipped++;
          continue;
        }

        // Dedup pass 1b: within this sync run, skip if same date+tab+title+evtIdBase
        // already queued. evtIdBase is included so two events with the same title
        // but different recurring-event bases produce two separate class blocks.
        const insertKey = `${listDate}|${classType}|${title.toLowerCase().trim()}|${evtIdBase}`;
        if (seenInsertKeys.has(insertKey)) {
          skipped++;
          continue;
        }

        // Dedup pass 2: date + tab + normalised title + evtIdBase (against existing DB rows)
        if (existingTitleKeys.has(insertKey)) {
          skipped++;
          continue;
        }

        // Insert one row (empty trainee slot) for this class.
        // ON CONFLICT DO NOTHING is the DB-level safety net — if calendar_event_id
        // already exists (e.g. from a concurrent or previous sync), the row is skipped.
        //
        // venue is auto-filled from event.location only for external classes,
        // where the venue is meaningful and varies per event. For other tabs
        // (Woods Square, Bukit Timah) the venue is implied by the tab.
        const venue = classType === 'external' ? location : '';
        await pool.query(
          `INSERT INTO public.masterlist_table
             (id, class_id, class_type, list_date, course_title, schedule_entries,
              calendar_event_id, entry_date, class_date, venue)
           VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [
            crypto.randomUUID(),     // row id
            crypto.randomUUID(),     // class_id
            classType,
            listDate,
            title,
            uniqueKey || null,
            entryDate,               // entry_date — formatted date(s) for the Date column
            classDateRange || null,  // class_date — links multi-day entries in UI
            venue || null,
          ],
        );

        if (uniqueKey) existingEventIds.add(uniqueKey);
        existingTitleKeys.add(insertKey);
        seenInsertKeys.add(insertKey);
        added++;
      }
    }

    // ── Step 4b: Backfill venue on existing external rows ────────────────────
    // Rows that were synced before venue auto-fill landed have empty venue.
    // For each external entry we know about now, fill its venue from the
    // calendar event's location — but only when the existing row is empty,
    // so admin edits are never overwritten.
    let venueBackfilled = 0;
    try {
      const calIds:   string[] = [];
      const venues:   string[] = [];
      for (const entry of dedupedFlatEntries) {
        if (entry.classType !== 'external') continue;
        if (!entry.evtId || !entry.location) continue;
        calIds.push(`${entry.evtId}_${entry.listDate}`);
        venues.push(entry.location);
      }
      if (calIds.length > 0) {
        const venueRes = await pool.query(
          `UPDATE public.masterlist_table m
              SET venue      = e.venue,
                  updated_at = now()
             FROM UNNEST($1::text[], $2::text[]) AS e(cal_id, venue)
            WHERE m.calendar_event_id = e.cal_id
              AND m.class_type        = 'external'
              AND (m.venue IS NULL OR TRIM(m.venue) = '')`,
          [calIds, venues],
        );
        venueBackfilled = venueRes.rowCount || 0;
      }
    } catch (e) {
      console.error('[masterlist-calendar-sync] venue backfill error:', e);
    }

    // ── Step 5: Orphan reconciliation ────────────────────────────────────────
    // Sync-created rows (calendar_event_id NOT NULL) whose (list_date,
    // class_type, normalised title) no longer matches any current calendar
    // event are "orphans". Without this step, badge counts on the Master
    // List page accumulate ghost classes over time.
    //
    // We split orphans into two buckets:
    //   (a) No trainee data           → DELETE (safe, automatic cleanup)
    //   (b) Has trainee name or email → FLAG (calendar_orphaned = true), so
    //                                   the admin sees a warning in the UI
    //                                   and decides whether to delete.
    //
    // Conversely, any row currently flagged calendar_orphaned that DOES
    // match an expected entry again (e.g. admin un-deleted the calendar
    // event) is un-flagged — keeps the warning state in sync with reality.
    //
    // Scoped to: list_dates inside the calendar fetch window only.
    let removed     = 0;
    let flagged     = 0;
    let unflagged   = 0;
    if (dedupedFlatEntries.length > 0) {
      const expectedDates: string[]     = [];
      const expectedTypes: string[]     = [];
      const expectedNormTitles: string[] = [];
      for (const entry of dedupedFlatEntries) {
        expectedDates.push(entry.listDate);
        expectedTypes.push(entry.classType);
        expectedNormTitles.push(entry.baseTitle.toLowerCase().trim());
      }

      const windowStart = `${fromYear}-01-01`;
      const windowEnd   = `${toYear}-01-01`;

      try {
        // (a) Hard-delete empty orphans
        const delRes = await pool.query(
          `WITH expected AS (
             SELECT list_date, class_type, norm_title
             FROM UNNEST($1::date[], $2::text[], $3::text[])
               AS t(list_date, class_type, norm_title)
           ),
           class_summary AS (
             SELECT
               class_id,
               MAX(list_date)                              AS list_date,
               MAX(class_type)                             AS class_type,
               LOWER(TRIM(MAX(course_title)))              AS norm_title,
               BOOL_AND(name  IS NULL OR TRIM(name)  = '') AS all_names_empty,
               BOOL_AND(email IS NULL OR TRIM(email) = '') AS all_emails_empty,
               BOOL_OR(calendar_event_id IS NOT NULL)      AS has_cal_id
             FROM public.masterlist_table
             GROUP BY class_id
           ),
           empty_orphans AS (
             SELECT cs.class_id
             FROM class_summary cs
             LEFT JOIN expected e
               ON e.list_date  = cs.list_date
              AND e.class_type = cs.class_type
              AND e.norm_title = cs.norm_title
             WHERE cs.has_cal_id
               AND cs.all_names_empty
               AND cs.all_emails_empty
               AND cs.list_date >= $4::date
               AND cs.list_date <  $5::date
               AND e.list_date IS NULL
           )
           DELETE FROM public.masterlist_table
           WHERE class_id IN (SELECT class_id FROM empty_orphans)`,
          [expectedDates, expectedTypes, expectedNormTitles, windowStart, windowEnd],
        );
        removed = delRes.rowCount || 0;

        // (b) Flag orphans that have trainee data — admin reviews them.
        const flagRes = await pool.query(
          `WITH expected AS (
             SELECT list_date, class_type, norm_title
             FROM UNNEST($1::date[], $2::text[], $3::text[])
               AS t(list_date, class_type, norm_title)
           ),
           class_summary AS (
             SELECT
               class_id,
               MAX(list_date)                              AS list_date,
               MAX(class_type)                             AS class_type,
               LOWER(TRIM(MAX(course_title)))              AS norm_title,
               BOOL_AND(name  IS NULL OR TRIM(name)  = '')
                AND BOOL_AND(email IS NULL OR TRIM(email) = '') AS all_empty,
               BOOL_OR(calendar_event_id IS NOT NULL)      AS has_cal_id,
               BOOL_AND(COALESCE(calendar_orphaned, false))  AS already_flagged
             FROM public.masterlist_table
             GROUP BY class_id
           ),
           orphan_targets AS (
             SELECT cs.class_id
             FROM class_summary cs
             LEFT JOIN expected e
               ON e.list_date  = cs.list_date
              AND e.class_type = cs.class_type
              AND e.norm_title = cs.norm_title
             WHERE cs.has_cal_id
               AND cs.all_empty = false
               AND cs.list_date >= $4::date
               AND cs.list_date <  $5::date
               AND e.list_date IS NULL
               AND cs.already_flagged = false
           )
           UPDATE public.masterlist_table
              SET calendar_orphaned = true,
                  updated_at        = now()
            WHERE class_id IN (SELECT class_id FROM orphan_targets)`,
          [expectedDates, expectedTypes, expectedNormTitles, windowStart, windowEnd],
        );
        flagged = flagRes.rowCount || 0;

        // (c) Un-flag rows that match the calendar again (event restored / re-renamed)
        const unflagRes = await pool.query(
          `WITH expected AS (
             SELECT list_date, class_type, norm_title
             FROM UNNEST($1::date[], $2::text[], $3::text[])
               AS t(list_date, class_type, norm_title)
           ),
           class_summary AS (
             SELECT
               class_id,
               MAX(list_date)                 AS list_date,
               MAX(class_type)                AS class_type,
               LOWER(TRIM(MAX(course_title))) AS norm_title
             FROM public.masterlist_table
             WHERE COALESCE(calendar_orphaned, false) = true
             GROUP BY class_id
           ),
           reborn AS (
             SELECT cs.class_id
             FROM class_summary cs
             JOIN expected e
               ON e.list_date  = cs.list_date
              AND e.class_type = cs.class_type
              AND e.norm_title = cs.norm_title
           )
           UPDATE public.masterlist_table
              SET calendar_orphaned = false,
                  updated_at        = now()
            WHERE class_id IN (SELECT class_id FROM reborn)`,
          [expectedDates, expectedTypes, expectedNormTitles],
        );
        unflagged = unflagRes.rowCount || 0;
      } catch (e) {
        console.error('[masterlist-calendar-sync] orphan reconciliation error:', e);
      }
    }

    return res.status(200).json({
      success: true,
      added,
      skipped,
      removed,
      flagged,
      unflagged,
      venueBackfilled,
      total: events.length,
    });
  } catch (err) {
    console.error('[masterlist-calendar-sync] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
