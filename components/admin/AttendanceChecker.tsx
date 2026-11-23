import React, { useState, useEffect } from 'react';

/**
 * Compact, auto-debounced attendance status for the Submit / Update Assessment views. Place it right
 * under the Trainee ID input: once Course Run ID + Trainee ID are filled it checks automatically and
 * shows whether the learner meets the requirement, with a "View sessions" toggle for the per-session
 * breakdown. Source is the LMS course_attendance (QR/TPG digital + manual marks) — more complete than
 * TPG alone. Read-only.
 */
interface SessionRow { sessionId: string; date: string | null; present: boolean; hadAttendance: boolean; }

const shortSession = (id: string) => { const p = id.split('-'); return p[p.length - 1] || id; };
const fmtDate = (d: string | null) => {
  if (!d) return '—';
  const m = String(d).replace(/-/g, '');
  return m.length === 8 ? `${m.slice(0, 4)}-${m.slice(4, 6)}-${m.slice(6, 8)}` : String(d);
};

const AttendanceChecker: React.FC<{ courseRunId: string; traineeId: string }> = ({ courseRunId, traineeId }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);

  useEffect(() => {
    const run = courseRunId.trim(), nric = traineeId.trim();
    setShowSessions(false);
    if (!run || !nric) { setData(null); setErr(null); setLoading(false); return; }
    setLoading(true); setErr(null);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/attendance-status?courseRunId=${encodeURIComponent(run)}&traineeId=${encodeURIComponent(nric)}`);
        const d = await r.json();
        if (!d.success) { setErr(d.error || 'Failed to check attendance'); setData(null); }
        else setData(d);
      } catch (e: any) {
        setErr(e?.message || 'Failed to check attendance'); setData(null);
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [courseRunId, traineeId]);

  if (!courseRunId.trim() || !traineeId.trim()) return null;

  return (
    <div className="mt-1.5 text-sm">
      {loading ? (
        <span className="text-xs text-muted">Checking attendance…</span>
      ) : err ? (
        <span className="text-xs text-danger">{err}</span>
      ) : data && !data.available ? (
        <span className="text-xs text-warning">⚠ {data.reason || 'No attendance recorded for this run yet.'}</span>
      ) : data ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${data.met ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
            {data.met ? '✅ Attendance met' : '❌ Attendance NOT met'} — {data.present}/{data.totalWithAttendance} = {data.percent}% (req {data.threshold}%)
          </span>
          {Array.isArray(data.sessions) && data.sessions.length > 0 && (
            <button type="button" onClick={() => setShowSessions((s) => !s)} className="text-xs text-primary hover:underline">
              {showSessions ? 'Hide sessions' : 'View sessions'}
            </button>
          )}
          {showSessions && Array.isArray(data.sessions) && (
            <div className="w-full mt-1 rounded border border-default overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-surface-elevated text-muted">
                  <tr>
                    <th className="text-left px-2 py-1 font-medium">Session</th>
                    <th className="text-left px-2 py-1 font-medium">Date</th>
                    <th className="text-left px-2 py-1 font-medium">Attendance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {(data.sessions as SessionRow[]).map((s) => (
                    <tr key={s.sessionId}>
                      <td className="px-2 py-1 font-mono text-on-surface-secondary">{shortSession(s.sessionId)}</td>
                      <td className="px-2 py-1 text-on-surface-secondary">{fmtDate(s.date)}</td>
                      <td className="px-2 py-1">
                        {s.present ? <span className="text-success font-medium">Present</span>
                          : s.hadAttendance ? <span className="text-danger font-medium">Absent</span>
                          : <span className="text-muted">No attendance taken</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default AttendanceChecker;
