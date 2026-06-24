import { getApiUrl } from '@/lib/urlHelpers';

/**
 * Poll the run's Google Calendar attendees until the calendar reflects the FINAL intended
 * state — the people we added are present and the people we removed are gone — so the UI
 * only reports "done" once the change has actually settled, not mid-propagation.
 *
 * The reconcile + "Adjust attendees" override apply in steps (create event → add the whole
 * roster → remove the unticked people). Reading the event right after can briefly show the
 * intermediate "everyone added" state, which reads as "assigned wrongly." This poll closes
 * that gap. Best-effort: returns ok=false (with what's still off) after the attempt budget;
 * never throws. Reads only (the GET endpoint uses the read-only calendar client).
 */
export interface VerifyResult {
  ok: boolean;
  attempts: number;
  missing: string[];   // expected-present emails not yet on the calendar
  lingering: string[]; // expected-absent emails still on the calendar
  checked: boolean;    // false when there was nothing to verify / calendar disabled
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function verifyRunCalendarAttendees(
  courseRunId: string,
  expect: { present?: string[]; absent?: string[] },
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<VerifyResult> {
  const present = [...new Set((expect.present || []).map((e) => (e || '').toLowerCase()).filter(Boolean))];
  const absent = [...new Set((expect.absent || []).map((e) => (e || '').toLowerCase()).filter(Boolean))];
  if (!present.length && !absent.length) return { ok: true, attempts: 0, missing: [], lingering: [], checked: false };
  const attempts = opts.attempts ?? 6;
  const delayMs = opts.delayMs ?? 1200;

  let missing = present.slice();
  let lingering = absent.slice();
  for (let i = 1; i <= attempts; i++) {
    const emails = new Set<string>();
    let reachable = false;
    try {
      const r = await fetch(getApiUrl(`/api/admin/calendar-attendees?courseRunId=${encodeURIComponent(courseRunId)}`));
      const d = await r.json();
      if (d?.success && d.status === 'ok') {
        reachable = true;
        for (const ev of (d.events || [])) for (const a of (ev.attendees || [])) emails.add((a.email || '').toLowerCase());
      } else if (d?.success && d.status === 'skipped') {
        return { ok: true, attempts: i, missing: [], lingering: [], checked: false }; // calendar disabled — nothing to verify
      }
    } catch { /* transient — retry */ }
    if (reachable) {
      missing = present.filter((e) => !emails.has(e));
      lingering = absent.filter((e) => emails.has(e));
      if (!missing.length && !lingering.length) return { ok: true, attempts: i, missing: [], lingering: [], checked: true };
    }
    if (i < attempts) await sleep(delayMs);
  }
  return { ok: false, attempts, missing, lingering, checked: true };
}

/** One-line description for the success/warning popup. Empty when nothing was checked. */
export function describeVerify(v: VerifyResult): string {
  if (!v.checked) return '';
  if (v.ok) return 'Calendar confirmed up to date.';
  const bits = [
    ...v.lingering.map((e) => `${e} not yet removed`),
    ...v.missing.map((e) => `${e} not yet added`),
  ];
  return `Calendar still updating (${bits.join('; ')}) — give it a moment and refresh to confirm.`;
}
