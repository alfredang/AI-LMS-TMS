import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';

interface CourseImageRow {
  id: string;
  course_code: string | null;
  title: string;
  image_url: string | null;
  has_local: boolean;
  local_url: string | null;
}

interface GenerateResult {
  id: string;
  title: string;
  status: 'ok' | 'failed';
  bytes?: number;
  local_url?: string;
  error?: string;
}

interface SyncResult {
  id: string;
  status: 'ok' | 'failed' | 'skipped';
  r2_url?: string;
  error?: string;
}

const BATCH_SIZE = 10;

type FilterMode = 'all' | 'missing' | 'has_local' | 'has_r2';

const CourseImageGeneratorView: React.FC = () => {
  const [courses, setCourses] = useState<CourseImageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');

  const [busy, setBusy] = useState<'idle' | 'generating' | 'syncing'>('idle');
  const [progressCur, setProgressCur] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fetchCourses = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/course-images/list');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to load');
      setCourses(data.courses);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCourses(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return courses.filter((c) => {
      if (filter === 'missing' && (c.image_url || c.has_local)) return false;
      if (filter === 'has_local' && !c.has_local) return false;
      if (filter === 'has_r2' && !c.image_url) return false;
      if (q && !(c.title.toLowerCase().includes(q) || (c.course_code || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [courses, filter, search]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((c) => next.delete(c.id));
      else filtered.forEach((c) => next.add(c.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pushLog = (line: string) => setLogLines((prev) => [...prev, line]);

  const runBatched = async <T,>(
    ids: string[],
    fn: (chunk: string[]) => Promise<T[]>,
    onResults: (chunk: T[]) => void,
  ) => {
    setProgressCur(0);
    setProgressTotal(ids.length);
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      try {
        const results = await fn(chunk);
        onResults(results);
      } catch (err) {
        pushLog(`❌ Batch ${i / BATCH_SIZE + 1} failed: ${err}`);
      }
      setProgressCur(Math.min(i + chunk.length, ids.length));
    }
  };

  const handleGenerate = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBusy('generating');
    setLogLines([`Generating ${ids.length} image${ids.length === 1 ? '' : 's'} in batches of ${BATCH_SIZE}...`]);
    try {
      await runBatched(ids, async (chunk) => {
        const r = await fetch('/api/admin/course-images/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseIds: chunk }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'generate failed');
        return data.results as GenerateResult[];
      }, (results) => {
        for (const res of results) {
          if (res.status === 'ok') {
            pushLog(`✅ ${res.id.slice(0, 8)}  ${(res.bytes! / 1024).toFixed(0)} KB  ${res.title.slice(0, 80)}`);
          } else {
            pushLog(`❌ ${res.id.slice(0, 8)}  ${res.error}`);
          }
        }
      });
      pushLog('Done.');
    } finally {
      setBusy('idle');
      await fetchCourses();
    }
  };

  const handleSync = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Sync ${ids.length} image${ids.length === 1 ? '' : 's'} to Cloudflare R2 and update course.image_url? This overwrites existing image_url values.`)) return;
    setBusy('syncing');
    setLogLines([`Syncing ${ids.length} image${ids.length === 1 ? '' : 's'} to R2 in batches of ${BATCH_SIZE}...`]);
    try {
      await runBatched(ids, async (chunk) => {
        const r = await fetch('/api/admin/course-images/sync-r2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseIds: chunk }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'sync failed');
        return data.results as SyncResult[];
      }, (results) => {
        for (const res of results) {
          if (res.status === 'ok') pushLog(`✅ ${res.id.slice(0, 8)}  ${res.r2_url}`);
          else if (res.status === 'skipped') pushLog(`⊘  ${res.id.slice(0, 8)}  ${res.error}`);
          else pushLog(`❌ ${res.id.slice(0, 8)}  ${res.error}`);
        }
      });
      pushLog('Done.');
    } finally {
      setBusy('idle');
      await fetchCourses();
    }
  };

  const counts = useMemo(() => ({
    total: courses.length,
    has_local: courses.filter((c) => c.has_local).length,
    has_r2: courses.filter((c) => c.image_url).length,
    missing: courses.filter((c) => !c.image_url && !c.has_local).length,
  }), [courses]);

  const progressPct = progressTotal > 0 ? Math.round((progressCur / progressTotal) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Course Image Generator</h1>
        <Button variant="ghost" onClick={fetchCourses} disabled={loading || busy !== 'idle'}>
          <Icon name={IconName.Sync} className="w-4 h-4 mr-1" />
          Refresh
        </Button>
      </div>

      <Card className="p-4 dark:bg-gray-800 dark:border-gray-700">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
          <Stat label="Total Courses" value={counts.total} />
          <Stat label="Has Local PNG" value={counts.has_local} />
          <Stat label="Synced to R2" value={counts.has_r2} />
          <Stat label="No Image" value={counts.missing} />
        </div>
      </Card>

      <Card className="p-4 dark:bg-gray-800 dark:border-gray-700 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search title or course code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[220px] px-3 py-2 border rounded-md dark:bg-gray-900 dark:border-gray-700 dark:text-white"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterMode)}
            className="px-3 py-2 border rounded-md dark:bg-gray-900 dark:border-gray-700 dark:text-white"
          >
            <option value="all">All ({counts.total})</option>
            <option value="missing">No image ({counts.missing})</option>
            <option value="has_local">Has local PNG ({counts.has_local})</option>
            <option value="has_r2">Synced to R2 ({counts.has_r2})</option>
          </select>
          <span className="text-sm text-gray-600 dark:text-gray-300 ml-2">
            {selected.size} selected
          </span>
          <div className="flex-1" />
          <Button
            variant="primary"
            onClick={handleGenerate}
            disabled={selected.size === 0 || busy !== 'idle'}
          >
            {busy === 'generating' ? 'Generating...' : `Generate (${selected.size})`}
          </Button>
          <Button
            variant="ghost"
            onClick={handleSync}
            disabled={selected.size === 0 || busy !== 'idle'}
            className="border border-blue-500 text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-900/20"
          >
            {busy === 'syncing' ? 'Syncing...' : `Sync to R2 (${selected.size})`}
          </Button>
        </div>

        {busy !== 'idle' && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
              <span>{busy === 'generating' ? 'Generating' : 'Syncing'}: {progressCur} / {progressTotal}</span>
              <span>{progressPct}%</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className="h-2 bg-blue-600 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {error && (
        <Card className="p-4 border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 text-red-800 dark:text-red-300">
          {error}
        </Card>
      )}

      <Card className="dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAll}
                    disabled={filtered.length === 0}
                  />
                </th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left w-20">Local</th>
                <th className="px-3 py-2 text-left w-20">R2</th>
                <th className="px-3 py-2 text-left w-24">Preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Loading...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">No courses match the filter.</td></tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">{c.course_code || '—'}</td>
                  <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{c.title}</td>
                  <td className="px-3 py-2">{c.has_local ? '✅' : '—'}</td>
                  <td className="px-3 py-2">{c.image_url ? '✅' : '—'}</td>
                  <td className="px-3 py-2">
                    {c.local_url || c.image_url ? (
                      <button
                        type="button"
                        className="text-blue-600 hover:underline text-xs"
                        onClick={() => setPreviewUrl(c.local_url || c.image_url)}
                      >
                        View
                      </button>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {logLines.length > 0 && (
        <Card className="p-4 dark:bg-gray-900 dark:border-gray-700">
          <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Activity Log</h3>
          <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 max-h-64 overflow-auto whitespace-pre-wrap">
            {logLines.join('\n')}
          </pre>
        </Card>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-full max-h-full rounded shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div>
    <div className="text-2xl font-bold text-gray-900 dark:text-white">{value.toLocaleString()}</div>
    <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
  </div>
);

export default CourseImageGeneratorView;
