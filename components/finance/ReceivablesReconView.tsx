import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Icon, IconName } from '../ui/Icon';
import {
  ChartCardHeader,
  OverdueSummary,
  SourceDonut,
  SourceStatusBars,
  StatusGroup,
  STATUS_GROUPS,
  sourceColor,
  useIsDarkTheme,
} from './ReceivablesReconCharts';

// Mirrors lib/services/receivablesRecon/overdueBreakdown.ts (kept local so the server module never enters the client bundle).
type SourceKey = 'grn' | 'sfc_ca' | 'sfc_tc' | 'company_tc' | 'individual_tc' | 'other';
type StatusKey =
  | 'tpg_paid_not_received'
  | 'tpg_completed_no_file'
  | 'paid_elsewhere'
  | 'partial_left'
  | 'cancelled'
  | 'waiting_tpg'
  | 'check'
  | 'customer_owes';

const SOURCES: Array<{ key: SourceKey; label: string; hint: string }> = [
  { key: 'grn', label: 'SSG Grant (GRN)', hint: 'GRN invoices billed to WSG — paid by TPG' },
  { key: 'sfc_ca', label: 'SFC – Direct Application', hint: 'SFC-CA invoices — paid by TPG SFC payout' },
  { key: 'sfc_tc', label: 'SFC – non-DA (on TC)', hint: '"To Less SkillsFuture Credit" amount still open on the TC' },
  { key: 'company_tc', label: 'Company (TC)', hint: 'What companies owe on their TC invoices' },
  { key: 'individual_tc', label: 'Individual learner (TC)', hint: 'What individual learners owe on their TC invoices' },
  { key: 'other', label: 'Other', hint: 'IBF / manual / non-WSQ invoices' },
];

const STATUSES: Record<StatusKey, { label: string; tone: string; action: string }> = {
  tpg_paid_not_received: { label: 'TPG paid – not received in QB', tone: 'red', action: 'Receive it via Bulk Grant Payment Sync / Bulk SFC payment update' },
  tpg_completed_no_file: { label: 'TPG paid (Completed) – file not uploaded', tone: 'red', action: 'Upload the latest TPG Financial Transaction Report in Bulk Grant Payment Sync' },
  paid_elsewhere: { label: 'Paid on another invoice', tone: 'red', action: 'Duplicate invoice or money on the wrong invoice — check both' },
  partial_left: { label: 'Received, balance left', tone: 'amber', action: 'Partial / spillover — check the invoice payments' },
  cancelled: { label: 'Cancelled on TPG – invoice open', tone: 'red', action: 'Delete or credit-note the invoice' },
  waiting_tpg: { label: 'Waiting for TPG', tone: 'violet', action: 'Nothing to receive yet — TPG has not paid' },
  check: { label: 'Needs checking', tone: 'amber', action: 'No grant / claim found in the LMS — check TPG' },
  customer_owes: { label: 'Customer owes', tone: 'gray', action: 'Follow up with the customer' },
};
const ACTIONABLE: StatusKey[] = ['tpg_paid_not_received', 'tpg_completed_no_file', 'paid_elsewhere', 'partial_left', 'cancelled'];
const groupOf = (s: StatusKey): StatusGroup =>
  ACTIONABLE.includes(s)
    ? 'action'
    : s === 'check'
      ? 'check'
      : s === 'waiting_tpg'
        ? 'waiting'
        : 'owes';

const TONE: Record<string, string> = {
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  gray: 'bg-surface-hover text-on-surface-secondary',
};

interface Attendance {
  enrolmentId: string;
  status: 'attended' | 'partial' | 'absent' | 'not_taken' | 'no_sessions' | 'error';
  attended: number;
  sessions: number;
  taken: number;
  checkedAt: string;
  note?: string;
}

// TPG attendance shown on "cancelled" rows: did the learner attend before TPG cancelled?
const ATTENDANCE_TONE: Record<Attendance['status'], string> = {
  attended: 'bg-success-bg text-success',
  partial: 'bg-warning-bg text-warning',
  absent: 'bg-danger-bg text-danger',
  not_taken: 'bg-surface-hover text-muted',
  no_sessions: 'bg-surface-hover text-muted',
  error: 'bg-surface-hover text-muted',
};
const attendanceLabel = (a: Attendance) =>
  a.status === 'no_sessions'
    ? 'TPG: no sessions on the run'
    : a.status === 'not_taken'
      ? `TPG: no attendance taken (${a.sessions} sessions)`
      : a.status === 'error'
        ? 'TPG attendance: could not read'
        : a.status === 'absent'
          ? `TPG: absent — 0 of ${a.taken} sessions`
          : `TPG: attended ${a.attended} of ${a.taken} sessions`;

interface OverdueRow {
  source: SourceKey;
  status: StatusKey;
  amount: number;
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  daysOverdue: number;
  aging: string;
  customer: string;
  invoiceBalance: number;
  duplicateNo: boolean;
  in2026: boolean;
  detail: string;
  attendance?: Attendance[];
  creditNotes?: Array<{ doc: string; date: string; customer: string; total: number; cites: string }>;
}
interface FloatingCredit {
  type: string;
  id: string;
  date: string;
  customer: string;
  ref: string;
  amount: number;
  total: number;
}
interface Breakdown {
  generatedAt: string;
  today: string;
  overdueTotal: number;
  invoiceCount: number;
  rows: OverdueRow[];
  floatingCredit: FloatingCredit[];
  tpgDataAsOf: {
    grantFileUpTo: string | null;
    sfcFileUpTo: string | null;
    grantsCheckedAt: string | null;
    claimsCheckedAt: string | null;
    enrolmentsCheckedAt?: string | null;
  };
}
interface JobState {
  running: boolean;
  kind: 'quickbooks' | 'tpg' | null;
  message: string;
  error: string | null;
  finishedAt: string | null;
}
interface Payload {
  job: JobState;
  snapshot: { createdAt: string; kind: string; result: Breakdown } | null;
  history: Array<{ createdAt: string; overdueTotal: number; invoiceCount: number }>;
}

const fmt = (n: number) => `$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const sum = (rows: Array<{ amount: number }>) => rows.reduce((s, r) => s + r.amount, 0);
const PAGE = 200;

const ReceivablesReconView: React.FC = () => {
  const [data, setData] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [only2026, setOnly2026] = useState(true);
  const [tab, setTab] = useState<'overdue' | 'credit' | 'history'>('overdue');
  const [filter, setFilter] = useState<{ source?: SourceKey; status?: StatusKey; group?: StatusGroup }>({});
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ grn: true, sfc_ca: true, sfc_tc: true });

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/finance/receivables-recon');
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'Failed to load');
      setData(j.data);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const running = !!data?.job.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [running, load]);

  const start = async (action: 'refresh' | 'refreshTpg') => {
    const r = await fetch('/api/finance/receivables-recon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const j = await r.json().catch(() => null);
    if (!j?.success && j?.error) setLoadError(j.error);
    await load();
  };

  const result = data?.snapshot?.result ?? null;
  const rows = useMemo(() => (result ? result.rows.filter((r) => !only2026 || r.in2026) : []), [result, only2026]);
  const total = sum(rows);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(
        (r) =>
          (!filter.source || r.source === filter.source) &&
          (!filter.status || r.status === filter.status) &&
          (!filter.group || groupOf(r.status) === filter.group)
      )
      .filter((r) => !q || `${r.invoiceNo} ${r.customer} ${r.detail} ${(r.creditNotes ?? []).map((c) => c.doc).join(' ')}`.toLowerCase().includes(q))
      .sort((a, b) => b.daysOverdue - a.daysOverdue || b.amount - a.amount);
  }, [rows, filter, search]);

  useEffect(() => setShown(PAGE), [filter, search, only2026]);

  const dark = useIsDarkTheme();
  const invoiceCount = useMemo(() => new Set(rows.map((r) => r.invoiceId)).size, [rows]);
  const sourceSlices = useMemo(
    () =>
      SOURCES.map((s) => {
        const sr = rows.filter((r) => r.source === s.key);
        return { key: s.key, label: s.label, amount: sum(sr), count: sr.length };
      }),
    [rows]
  );
  const groupSlices = useMemo(
    () =>
      STATUS_GROUPS.map((g) => {
        const gr = rows.filter((r) => groupOf(r.status) === g.key);
        return { key: g.key, label: g.label, amount: sum(gr), count: gr.length };
      }),
    [rows]
  );
  const pick = (f: { source?: SourceKey; group?: StatusGroup }) => {
    setFilter((cur) => (cur.source === f.source && cur.group === f.group && !cur.status ? {} : f));
    setTab('overdue');
  };

  const exportExcel = () => {
    if (!result) return;
    const wb = XLSX.utils.book_new();
    const summary: any[] = [{ Source: 'TOTAL', Status: '', Amount: total, Invoices: new Set(rows.map((r) => r.invoiceId)).size }];
    for (const s of SOURCES) {
      const sr = rows.filter((r) => r.source === s.key);
      if (!sr.length) continue;
      summary.push({ Source: s.label, Status: '(all)', Amount: sum(sr), Invoices: sr.length });
      for (const k of Object.keys(STATUSES) as StatusKey[]) {
        const t = sr.filter((r) => r.status === k);
        if (t.length) summary.push({ Source: '', Status: STATUSES[k].label, Amount: sum(t), Invoices: t.length, 'What to do': STATUSES[k].action });
      }
    }
    summary.push({}, { Source: `QuickBooks read ${when(result.generatedAt)}. TPG grant file up to ${dmy(result.tpgDataAsOf.grantFileUpTo)}, SFC up to ${dmy(result.tpgDataAsOf.sfcFileUpTo)}.` });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
    const sheetRows = (rs: OverdueRow[]) =>
      rs.map((r) => ({
        Status: STATUSES[r.status].label,
        Amount: r.amount,
        'Invoice No': r.invoiceNo,
        'Invoice Date': dmy(r.invoiceDate),
        'Due Date': dmy(r.dueDate),
        'Days Overdue': r.daysOverdue,
        Customer: r.customer,
        'Invoice Balance': r.invoiceBalance,
        'Duplicate No.': r.duplicateNo ? 'YES' : '',
        'Credit Note': (r.creditNotes ?? []).map((c) => `${c.doc} (${c.customer}, ${dmy(c.date)}, $${c.total})`).join('; ') || 'Not issued',
        'TPG Attendance': (r.attendance ?? []).map((a) => `${a.enrolmentId}: ${attendanceLabel(a).replace(/^TPG[^:]*: ?/, '')}`).join('; '),
        Detail: r.detail,
      }));
    for (const s of SOURCES) {
      const sr = rows.filter((r) => r.source === s.key).sort((a, b) => a.status.localeCompare(b.status) || b.amount - a.amount);
      if (sr.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows(sr)), s.label.replace(/[\\/?*[\]:]/g, '').slice(0, 31));
    }
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(result.floatingCredit.map((c) => ({ Type: c.type, Date: dmy(c.date), Customer: c.customer, Ref: c.ref, 'Open Amount': c.amount, Total: c.total }))),
      'Floating credit'
    );
    XLSX.writeFile(wb, `Overdue_Breakdown_${result.today.replace(/-/g, '')}.xlsx`);
  };

  const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—');
  const job = data?.job;

  const asOf = result?.tpgDataAsOf;
  const freshness: Array<{ label: string; value: string; stale?: boolean }> = result
    ? [
        { label: 'QuickBooks', value: when(result.generatedAt) },
        { label: 'TPG grants', value: when(asOf?.grantsCheckedAt ?? null), stale: !asOf?.grantsCheckedAt },
        { label: 'TPG enrolments', value: asOf?.enrolmentsCheckedAt ? when(asOf.enrolmentsCheckedAt) : 'not checked yet', stale: !asOf?.enrolmentsCheckedAt },
        { label: 'Grant file', value: `to ${dmy(asOf?.grantFileUpTo ?? null)}` },
        { label: 'SFC file', value: `to ${dmy(asOf?.sfcFileUpTo ?? null)}` },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-on-surface">Receivables Reconciliation</h2>
          <p className="text-on-surface-secondary mt-1.5">
            Where the QuickBooks overdue comes from, checked against TPG. Read-only — receive payments in Bulk Grant Payment Sync or SFC Payment Sync.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:justify-end xl:flex-nowrap">
          <Button variant="primary" disabled={running} onClick={() => void start('refresh')} leftIcon={<Icon name={IconName.Sync} className="w-4 h-4" />} className="whitespace-nowrap">
            Refresh
          </Button>
          <Button variant="outline" disabled={running || !result} onClick={() => void start('refreshTpg')} className="whitespace-nowrap" title="Re-checks grants, SFC claims and enrolments on TPG, then QuickBooks (about 15 minutes)">
            Refresh with TPG check
          </Button>
          <Button variant="ghost" disabled={!result} onClick={exportExcel} className="whitespace-nowrap">
            Export Excel
          </Button>
        </div>
      </div>

      {loadError && <div className="rounded-md bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 px-4 py-3 text-sm">{loadError}</div>}

      {job?.running && (
        <div role="status" className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-100 px-4 py-3 text-sm flex items-center gap-3">
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin motion-reduce:animate-none shrink-0" />
          <span>
            <b>{job.kind === 'tpg' ? 'Checking TPG, then QuickBooks' : 'Refreshing from QuickBooks'}</b> — {job.message}. Takes a few minutes; you can leave this page.
          </span>
        </div>
      )}
      {!job?.running && job?.error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 px-4 py-3 text-sm">Last refresh failed: {job.error}</div>
      )}

      {!result && !job?.running && data && (
        <Card className="p-8 text-center">
          <p className="text-on-surface-secondary">No breakdown yet. Click “Refresh” to build the first one.</p>
        </Card>
      )}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {freshness.map((f) => (
              <span
                key={f.label}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                  f.stale
                    ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
                    : 'border-default bg-surface text-on-surface-secondary'
                }`}
              >
                <span className="text-muted">{f.label}</span>
                <span className="font-medium">{f.value}</span>
              </span>
            ))}
            <label className="ml-auto inline-flex items-center gap-2 text-sm text-on-surface-secondary cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 cursor-pointer" checked={only2026} onChange={(e) => setOnly2026(e.target.checked)} />
              Invoices dated 2026 only
            </label>
          </div>

          <Card className="p-6">
            <ChartCardHeader title="What needs to happen to the overdue" hint="Each invoice balance checked against TPG — click a part to list its invoices" />
            <OverdueSummary
              groups={groupSlices}
              total={total}
              invoiceCount={invoiceCount}
              active={filter.status || filter.source ? undefined : filter.group}
              onSelect={(k) => pick({ group: k })}
            />
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-6">
              <ChartCardHeader title="Who owes it" hint="Overdue by source — click a slice or row" />
              <SourceDonut
                slices={sourceSlices}
                total={total}
                active={filter.status || filter.group ? undefined : filter.source}
                onSelect={(k) => pick({ source: k })}
              />
            </Card>
            <Card className="p-6">
              <ChartCardHeader title="Each source by what needs to happen" hint="Bars scaled to the largest source — click a segment" />
              <SourceStatusBars
                sources={sourceSlices}
                amountOf={(src, g) => sum(rows.filter((r) => r.source === src && groupOf(r.status) === g))}
                active={filter.status ? undefined : { source: filter.source, group: filter.group }}
                onSelect={(src, g) => pick(g ? { source: src, group: g } : { source: src })}
              />
            </Card>
          </div>

          <Card className="p-0">
            <div className="px-6 pt-5 pb-4 border-b border-default">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Breakdown by source and TPG status</h3>
              <p className="text-xs text-muted mt-1">Click a status to list its invoices below</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="px-4 py-2">Source / status</th>
                  <th className="px-4 py-2 text-right">Invoices</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-right">Share</th>
                  <th className="px-4 py-2 hidden lg:table-cell">What to do</th>
                </tr>
              </thead>
              <tbody>
                {SOURCES.map((s) => {
                  const sr = rows.filter((r) => r.source === s.key);
                  if (!sr.length) return null;
                  const open = !!expanded[s.key];
                  return (
                    <React.Fragment key={s.key}>
                      <tr className="border-t border-default bg-surface-elevated">
                        <td className="px-4 py-2 font-semibold text-on-surface">
                          <button className="flex items-center gap-2" onClick={() => setExpanded((p) => ({ ...p, [s.key]: !open }))}>
                            <span className="w-4 text-muted">{open ? '▾' : '▸'}</span>
                            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: sourceColor(s.key, dark) }} />
                            {s.label}
                          </button>
                          <div className="text-xs font-normal text-muted ml-6">{s.hint}</div>
                        </td>
                        <td className="px-4 py-2 text-right text-on-surface-secondary">{sr.length}</td>
                        <td className="px-4 py-2 text-right font-semibold text-on-surface">
                          <button className="hover:underline" onClick={() => setFilter({ source: s.key })}>{fmt(sum(sr))}</button>
                        </td>
                        <td className="px-4 py-2 text-right text-on-surface-secondary">{pct(sum(sr))}</td>
                        <td className="px-4 py-2 hidden lg:table-cell">
                          <div className="h-2 w-full max-w-xs rounded bg-surface-hover overflow-hidden">
                            <div className="h-full rounded" style={{ width: total > 0 ? `${(sum(sr) / total) * 100}%` : 0, background: sourceColor(s.key, dark) }} />
                          </div>
                        </td>
                      </tr>
                      {open &&
                        (Object.keys(STATUSES) as StatusKey[]).map((k) => {
                          const t = sr.filter((r) => r.status === k);
                          if (!t.length) return null;
                          const active = filter.source === s.key && filter.status === k;
                          return (
                            <tr
                              key={k}
                              className={`border-t border-default cursor-pointer hover:bg-surface-hover ${active ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
                              onClick={() => {
                                setFilter({ source: s.key, status: k });
                                setTab('overdue');
                              }}
                            >
                              <td className="px-4 py-2 pl-10">
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TONE[STATUSES[k].tone]}`}>{STATUSES[k].label}</span>
                              </td>
                              <td className="px-4 py-2 text-right text-on-surface-secondary">{t.length}</td>
                              <td className="px-4 py-2 text-right text-on-surface-secondary">{fmt(sum(t))}</td>
                              <td className="px-4 py-2 text-right text-muted">{pct(sum(t))}</td>
                              <td className="px-4 py-2 text-muted hidden lg:table-cell">{STATUSES[k].action}</td>
                            </tr>
                          );
                        })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div className="flex gap-2 border-b border-default">
            {[
              { k: 'overdue' as const, l: `Overdue invoices (${filtered.length})` },
              { k: 'credit' as const, l: `Floating credit (${fmt(sum(result.floatingCredit))})` },
              { k: 'history' as const, l: 'History' },
            ].map((t) => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.k ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-muted'}`}
              >
                {t.l}
              </button>
            ))}
          </div>

          {tab === 'overdue' && (
            <Card className="p-0">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-default">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search invoice no, customer, GRN, enrolment, claim, credit note…"
                  className="flex-1 min-w-[220px] px-3 py-2 border rounded-md text-sm bg-surface border-strong text-on-surface"
                />
                {(filter.source || filter.status || filter.group) && (
                  <button className="text-sm text-blue-600 dark:text-blue-400 hover:underline" onClick={() => setFilter({})}>
                    Clear filter:{' '}
                    {[
                      filter.source && SOURCES.find((s) => s.key === filter.source)?.label,
                      filter.group && STATUS_GROUPS.find((g) => g.key === filter.group)?.label,
                      filter.status && STATUSES[filter.status].label,
                    ]
                      .filter(Boolean)
                      .join(' · ')}{' '}
                    ✕
                  </button>
                )}
                <span className="text-sm text-muted ml-auto">Total {fmt(sum(filtered))}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="px-4 py-2">Invoice</th>
                      <th className="px-4 py-2">Customer</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2 text-right">Days overdue</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 whitespace-nowrap">Credit note</th>
                      <th className="px-4 py-2">TPG / payment detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, shown).map((r, idx) => (
                      <tr key={`${r.invoiceId}-${r.source}-${r.status}-${idx}`} className="border-t border-default align-top">
                        <td className="px-4 py-2 whitespace-nowrap">
                          <div className="font-medium text-on-surface">
                            {r.invoiceNo}
                            {r.duplicateNo && <span className="ml-2 text-xs text-red-600 dark:text-red-400" title="This invoice number exists more than once in QuickBooks">duplicate no.</span>}
                          </div>
                          <div className="text-xs text-muted">
                            {dmy(r.invoiceDate)} · due {dmy(r.dueDate)}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-on-surface-secondary">{r.customer}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap text-on-surface-secondary">
                          {fmt(r.amount)}
                          {Math.abs(r.amount - r.invoiceBalance) > 0.004 && <div className="text-xs text-muted">of {fmt(r.invoiceBalance)}</div>}
                        </td>
                        <td className="px-4 py-2 text-right text-on-surface-secondary">{r.daysOverdue}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${TONE[STATUSES[r.status].tone]}`}>{STATUSES[r.status].label}</span>
                          {r.status === 'cancelled' && (
                            <div className="mt-1.5 flex flex-col items-start gap-1">
                              {r.attendance?.length ? (
                                r.attendance.map((a) => (
                                  <span
                                    key={a.enrolmentId}
                                    title={`${a.enrolmentId} · checked on TPG ${when(a.checkedAt)}${a.note ? ` · ${a.note}` : ''}`}
                                    className={`inline-block px-2 py-0.5 rounded text-xs whitespace-nowrap ${ATTENDANCE_TONE[a.status]}`}
                                  >
                                    {attendanceLabel(a)}
                                    {r.attendance!.length > 1 ? ` · ${a.enrolmentId}` : ''}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-muted">TPG attendance not checked yet — Refresh</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {r.creditNotes?.length ? (
                            <div className="flex flex-col items-start gap-1">
                              {r.creditNotes.map((c) => (
                                <span
                                  key={c.doc}
                                  title={`${c.doc} · ${c.customer} · ${dmy(c.date)} · ${fmt(c.total)} · cites ${c.cites}`}
                                  className="inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-success-bg text-success"
                                >
                                  Issued · {c.doc}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted whitespace-nowrap">Not issued</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-on-surface-secondary break-words max-w-xl">{r.detail}</td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-muted">No invoices match.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {filtered.length > shown && (
                <div className="px-4 py-3 text-center">
                  <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                    Show more ({filtered.length - shown} left)
                  </Button>
                </div>
              )}
            </Card>
          )}

          {tab === 'credit' && (
            <Card className="p-0">
              <p className="px-4 py-3 text-sm text-on-surface-secondary border-b border-default">
                Money already in QuickBooks but not applied to any invoice. It is not in the overdue figure, and QuickBooks staff screens can tick it onto other open
                invoices (spillover) — each one should be applied to its own invoice or removed.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="px-4 py-2">Type</th>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Customer</th>
                      <th className="px-4 py-2">Ref / No.</th>
                      <th className="px-4 py-2 text-right">Open amount</th>
                      <th className="px-4 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.floatingCredit]
                      .sort((a, b) => b.amount - a.amount)
                      .map((c) => (
                        <tr key={`${c.type}-${c.id}`} className="border-t border-default">
                          <td className="px-4 py-2 text-on-surface-secondary">{c.type}</td>
                          <td className="px-4 py-2 text-on-surface-secondary">{dmy(c.date)}</td>
                          <td className="px-4 py-2 text-on-surface-secondary">{c.customer}</td>
                          <td className="px-4 py-2 text-on-surface-secondary">{c.ref || '—'}</td>
                          <td className="px-4 py-2 text-right text-on-surface-secondary">{fmt(c.amount)}</td>
                          <td className="px-4 py-2 text-right text-muted">{fmt(c.total)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {tab === 'history' && (
            <Card className="p-0">
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="px-4 py-2">Refreshed</th>
                    <th className="px-4 py-2 text-right">Overdue in QuickBooks (all)</th>
                    <th className="px-4 py-2 text-right">Invoices</th>
                    <th className="px-4 py-2 text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.history ?? []).map((h, i, arr) => {
                    const prev = arr[i + 1];
                    const diff = prev ? h.overdueTotal - prev.overdueTotal : null;
                    return (
                      <tr key={h.createdAt} className="border-t border-default">
                        <td className="px-4 py-2 text-on-surface-secondary">{when(h.createdAt)}</td>
                        <td className="px-4 py-2 text-right text-on-surface-secondary">{fmt(h.overdueTotal)}</td>
                        <td className="px-4 py-2 text-right text-on-surface-secondary">{h.invoiceCount}</td>
                        <td className={`px-4 py-2 text-right ${diff === null ? '' : diff > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                          {diff === null ? '—' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default ReceivablesReconView;
