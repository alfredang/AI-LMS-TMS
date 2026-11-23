import React, { useCallback, useEffect, useState } from 'react';

interface CatalogItem { slug: string; code: string; title: string; vendor: string }

/**
 * Course editor → Course Settings → Practice Exam. Turns the practice exam on/off
 * for a course and picks which exam on exams.tertiaryinfotech.com it maps to. When
 * on, trainers get a Practice Exam section on the class page (after Lesson) to
 * register the class's learners. Saves immediately — it is not part of "Save Course".
 * Renders nothing when the Exams integration is not configured for this tenant.
 */
export function CoursePracticeExamSetting({ courseId }: { courseId: string }) {
  const [configured, setConfigured] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [saved, setSaved] = useState('');   // slug of the saved exam ('' = off)
  const [enabled, setEnabled] = useState(false);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/practice-exam/course?courseId=${encodeURIComponent(courseId)}`);
      const json = await res.json();
      if (!res.ok || !json.success || !json.configured) return setConfigured(false);
      const items: CatalogItem[] = json.catalog || [];
      const code = String(json.examCode || '');
      const hit = items.find(c => c.slug === code || c.code.toUpperCase() === code.toUpperCase());
      const slug = hit ? hit.slug : code;
      setConfigured(true);
      setCatalog(items);
      setSaved(slug);
      setPick(slug);
      setEnabled(!!slug);
      if (json.warning) setNote({ ok: false, text: json.warning });
    } catch {
      setConfigured(false);
    }
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const save = async (examCode: string) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/practice-exam/course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, examCode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setNote({ ok: false, text: json.error || 'Could not save' });
        return false;
      }
      setSaved(examCode);
      setNote({ ok: true, text: examCode ? 'Saved. Trainers now see the Practice Exam section on the class page.' : 'Practice exam turned off for this course.' });
      return true;
    } catch {
      setNote({ ok: false, text: 'Request failed. Please try again.' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (busy) return;
    if (enabled) {
      // Turning off: clear the saved link (if any).
      if (saved && !(await save(''))) return;
      setEnabled(false);
      setPick('');
    } else {
      setEnabled(true);
      setNote(null);
    }
  };

  if (!configured) return null;
  const known = !pick || catalog.some(c => c.slug === pick);

  return (
    <div className="p-3 bg-surface-elevated rounded-md border dark:border-gray-600">
      <div className="flex justify-between items-center gap-3">
        <div>
          <p className="font-semibold text-sm">Practice Exam</p>
          <p className="text-xs text-subtle">
            This course has a practice exam on Tertiary Exams. Trainers can register the class&apos;s learners from the class page.
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-600'}`}
          aria-pressed={enabled}
          aria-label="Practice exam for this course"
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {enabled && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
            <span className="text-subtle">Practice exam</span>
            <select
              value={pick}
              onChange={e => setPick(e.target.value)}
              className="w-full rounded border border-strong bg-surface px-2 py-1.5 text-sm text-on-surface"
            >
              <option value="">— Select an exam —</option>
              {!known && <option value={pick}>{pick} (not found)</option>}
              {catalog.map(c => (
                <option key={c.slug} value={c.slug}>{c.code} — {c.title}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => save(pick)}
            disabled={busy || !pick || pick === saved}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving…' : pick && pick === saved ? 'Saved' : 'Save'}
          </button>
        </div>
      )}

      {note && <p className={`mt-2 text-xs ${note.ok ? 'text-success' : 'text-danger'}`}>{note.text}</p>}
    </div>
  );
}
