import type { NextApiRequest, NextApiResponse } from 'next';
import { google } from 'googleapis';
import pool from '../../../lib/db';
import { getGoogleCredentials } from '../../../lib/google-auth/googleAuth';

type ClassTabType =
  | 'virtual'
  | 'evening'
  | 'external'
  | 'woodsSquare'
  | 'reschedule'
  | 'cancelled'
  | 'bukitTimah';

/**
 * Detect which MasterList tab an event belongs to based on its title and start time.
 *
 * Rules:
 *  - [VIRTUAL] or "Virtual Class/Classroom" in title → virtual
 *  - [EXTERNAL] in title → external
 *  - Start time ≥ 18:00 SGT → evening
 *  - Otherwise → woodsSquare (default)
 */
function detectTab(title: string, startDateTime: string | null | undefined): ClassTabType {
  const upper = (title || '').toUpperCase();
  if (/\[VIRTUAL\]/.test(upper) || /VIRTUAL\s*(CLASS|CLASSROOM)/i.test(title)) return 'virtual';
  if (/\[EXTERNAL\]/.test(upper)) return 'external';
  if (startDateTime) {
    const d = new Date(startDateTime);
    const sgtHour = (d.getUTCHours() + 8) % 24;
    if (sgtHour >= 18) return 'evening';
  }
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
    // After normalising titles, two class blocks that previously had "Day 1 - X"
    // and "ONE DAY - X" now both have title "X" on the same date → deduplicate.
    // Keep the class_id with real trainee data (name not empty); if tied, keep oldest.
    //
    // Safety guard: only run the dedup DELETE when there are actual duplicates
    // (total calendar-synced class_ids > distinct keepers). If keepers would be
    // empty or equal to total, skip to avoid an accidental mass-delete.
    const dedupCheck = await pool.query(`
      WITH class_info AS (
        SELECT
          class_id,
          list_date,
          class_type,
          LOWER(TRIM(COALESCE(course_title, ''))) AS norm_title,
          BOOL_OR(name IS NOT NULL AND TRIM(name) <> '')  AS has_data,
          MIN(created_at)                                  AS earliest
        FROM public.masterlist_table
        WHERE calendar_event_id IS NOT NULL
        GROUP BY class_id, list_date, class_type,
          LOWER(TRIM(COALESCE(course_title, '')))
      ),
      keepers AS (
        SELECT DISTINCT ON (list_date, class_type, norm_title)
          class_id
        FROM class_info
        ORDER BY list_date, class_type, norm_title,
          has_data DESC, earliest ASC
      )
      SELECT
        (SELECT COUNT(DISTINCT class_id) FROM public.masterlist_table WHERE calendar_event_id IS NOT NULL) AS total,
        (SELECT COUNT(*) FROM keepers) AS keeping
    `);
    const { total, keeping } = dedupCheck.rows[0] as { total: string; keeping: string };
    const totalN   = parseInt(total,   10);
    const keepingN = parseInt(keeping, 10);
    // Only delete if keepers is non-empty AND there are actual duplicates to remove
    if (keepingN > 0 && totalN > keepingN) {
      await pool.query(`
        WITH class_info AS (
          SELECT
            class_id,
            list_date,
            class_type,
            LOWER(TRIM(COALESCE(course_title, ''))) AS norm_title,
            BOOL_OR(name IS NOT NULL AND TRIM(name) <> '')  AS has_data,
            MIN(created_at)                                  AS earliest
          FROM public.masterlist_table
          WHERE calendar_event_id IS NOT NULL
          GROUP BY class_id, list_date, class_type,
            LOWER(TRIM(COALESCE(course_title, '')))
        ),
        keepers AS (
          SELECT DISTINCT ON (list_date, class_type, norm_title)
            class_id
          FROM class_info
          ORDER BY list_date, class_type, norm_title,
            has_data DESC, earliest ASC
        )
        DELETE FROM public.masterlist_table
        WHERE calendar_event_id IS NOT NULL
          AND class_id NOT IN (SELECT class_id FROM keepers)
      `);
    }

    // ── Step C: Rebuild the title+date unique index ───────────────────────────
    // Safe to create now that Steps A+B have normalised and deduplicated all rows.
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_masterlist_cal_title_date_unique
       ON public.masterlist_table(list_date, class_type, LOWER(TRIM(course_title)))
       WHERE calendar_event_id IS NOT NULL`,
    );
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

    // Also pre-load existing (list_date, class_type, lower title) combos for fuzzy dedup
    const existingTitlesRes = await pool.query(
      `SELECT list_date::text, class_type, LOWER(TRIM(course_title)) AS title
       FROM public.masterlist_table
       WHERE course_title IS NOT NULL`,
    );
    const existingTitleKeys = new Set<string>(
      existingTitlesRes.rows.map((r: any) => `${r.list_date}|${r.class_type}|${r.title}`),
    );

    // ── Step 1: Expand all events into flat (date, meta) entries ─────────────
    // A single Google Calendar event can span multiple days; separate calendar
    // events can also represent individual days of the same multi-day course.
    // We need to handle both cases before we can assign Day N / ONE DAY labels.

    interface FlatEntry {
      listDate: string;
      evtId: string;
      rawTitle: string;
      baseTitle: string;
      classType: ClassTabType;
    }

    const flatEntries: FlatEntry[] = [];

    for (const evt of events) {
      const rawTitle = evt.summary || '';
      const baseTitle = stripTitle(rawTitle);
      const classType = detectTab(rawTitle, evt.start?.dateTime);
      const evtId = evt.id || '';

      // Resolve start date in SGT
      let startDate: string;
      if (evt.start?.dateTime) {
        const sgt = new Date(new Date(evt.start.dateTime).getTime() + 8 * 3600000);
        startDate = sgt.toISOString().slice(0, 10);
      } else if (evt.start?.date) {
        startDate = evt.start.date;
      } else {
        continue; // no date — skip
      }

      // Resolve end date in SGT (inclusive)
      let endDate: string = startDate;
      if (evt.end?.dateTime) {
        const sgt = new Date(new Date(evt.end.dateTime).getTime() + 8 * 3600000);
        endDate = sgt.toISOString().slice(0, 10);
      } else if (evt.end?.date) {
        // Google Calendar all-day end is exclusive → subtract 1 day
        const d = new Date(evt.end.date + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        endDate = d.toISOString().slice(0, 10);
      }

      // Expand single multi-day event (e.g. Mon–Fri block) into daily entries
      const cur = new Date(startDate + 'T00:00:00Z');
      const end = new Date(endDate + 'T00:00:00Z');
      while (cur <= end) {
        flatEntries.push({
          listDate: cur.toISOString().slice(0, 10),
          evtId,
          rawTitle,
          baseTitle,
          classType,
        });
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    // ── Step 1b: Deduplicate flat entries ─────────────────────────────────────
    // Two different calendar events can share the same title, classType, and date
    // (e.g. a recurring occurrence + a standalone event). If we let both through,
    // the clustering algorithm treats them as a 2-day run and assigns "Day 1" /
    // "Day 2" labels — producing two class blocks instead of one.
    // Keep only the first entry per (listDate, classType, normalisedBaseTitle).
    const seenFlatKeys = new Set<string>();
    const dedupedFlatEntries: FlatEntry[] = [];
    for (const entry of flatEntries) {
      const normBase = entry.baseTitle
        .replace(/^(Day\s+\d+|ONE\s*DAY)\s*[-–]\s*/i, '')
        .toLowerCase()
        .trim();
      const flatKey = `${entry.listDate}|${entry.classType}|${normBase}`;
      if (seenFlatKeys.has(flatKey)) continue;
      seenFlatKeys.add(flatKey);
      dedupedFlatEntries.push(entry);
    }

    // ── Step 2: Group entries by normalised base title ────────────────────────
    // Strip any existing "Day N -" or "ONE DAY -" prefix from the grouping key
    // so that calendar events like "Day 1 - Course X" and "Day 2 - Course X"
    // are clustered into the same run and share the correct date range.
    // The original baseTitle (with its prefix) is preserved for display.
    const groupsByTitle = new Map<string, FlatEntry[]>();
    for (const entry of dedupedFlatEntries) {
      const key = entry.baseTitle
        .replace(/^(Day\s+\d+|ONE\s*DAY)\s*[-–]\s*/i, '')
        .toLowerCase()
        .trim();
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
        const { listDate, evtId, baseTitle, classType } = run[i];

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

        // Dedup pass 1b: within this sync run, skip if same date+tab+title already queued
        const insertKey = `${listDate}|${classType}|${title.toLowerCase().trim()}`;
        if (seenInsertKeys.has(insertKey)) {
          skipped++;
          continue;
        }

        // Dedup pass 2: date + tab + normalised title (against existing DB rows)
        if (existingTitleKeys.has(`${listDate}|${classType}|${title.toLowerCase().trim()}`)) {
          skipped++;
          continue;
        }

        // Insert one row (empty trainee slot) for this class.
        // ON CONFLICT DO NOTHING is the DB-level safety net — if calendar_event_id
        // already exists (e.g. from a concurrent or previous sync), the row is skipped.
        await pool.query(
          `INSERT INTO public.masterlist_table
             (id, class_id, class_type, list_date, course_title, schedule_entries,
              calendar_event_id, entry_date, class_date)
           VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6, $7, $8)
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
          ],
        );

        if (uniqueKey) existingEventIds.add(uniqueKey);
        existingTitleKeys.add(insertKey);
        seenInsertKeys.add(insertKey);
        added++;
      }
    }

    return res.status(200).json({ success: true, added, skipped, total: events.length });
  } catch (err) {
    console.error('[masterlist-calendar-sync] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
