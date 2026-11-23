import pool from '@/lib/db';
import { callQbProxyData } from '@/lib/quickbooks/qbProxyClient';
import type { TpgAttendance } from './tpgAttendance';

/**
 * Receivables Reconciliation — where the QuickBooks "Overdue" figure comes from.
 *
 * READ-ONLY. Reads open/overdue invoices and payments live from QuickBooks, and the LMS copies of
 * TPG data (ssg_grants / ssg_claims, refreshed live by tpgStatusRefresh, plus the TPG files Finance
 * uploaded to Bulk Grant Payment Sync / Bulk SFC payment update). Every overdue invoice balance is
 * split into a source (GRN grant, SFC-CA, non-DA SFC on the TC, company TC, individual TC, other)
 * and a status against TPG (paid but not received, on another invoice, cancelled, waiting, ...).
 * Nothing is written to QuickBooks or TPG; fixes still go through the bulk features one at a time.
 *
 * Matching follows the Bulk Grant / Bulk SFC rules: grants by the GRN cited on the invoice line
 * ("Grant Ref #: GRN-…"), never by bank ref alone; SFC only counts as paid when TPG shows it
 * disbursed (payout request id + disbursement date), never on claim status alone.
 */

export type SourceKey = 'grn' | 'sfc_ca' | 'sfc_tc' | 'company_tc' | 'individual_tc' | 'other';

export const SOURCE_LABELS: Record<SourceKey, string> = {
  grn: 'SSG Grant (GRN)',
  sfc_ca: 'SFC – Direct Application (SFC-CA)',
  sfc_tc: 'SFC – non-DA (on TC)',
  company_tc: 'Company (TC)',
  individual_tc: 'Individual learner (TC)',
  other: 'Other (IBF / manual / non-WSQ)',
};

export type StatusKey =
  | 'tpg_paid_not_received'
  | 'tpg_completed_no_file'
  | 'paid_elsewhere'
  | 'partial_left'
  | 'cancelled'
  | 'waiting_tpg'
  | 'check'
  | 'customer_owes'
  | 'credit_note';

export const STATUS_LABELS: Record<StatusKey, string> = {
  tpg_paid_not_received: 'TPG paid – not received in QB',
  tpg_completed_no_file: 'TPG paid (Completed) – disbursement file not uploaded yet',
  paid_elsewhere: 'Paid on another invoice (duplicate / wrong invoice)',
  partial_left: 'Received, but balance left (partial / spillover)',
  cancelled: 'Cancelled on TPG – invoice still open',
  waiting_tpg: 'Waiting for TPG (processing / pending payout)',
  check: 'Needs checking (no grant / claim record)',
  customer_owes: 'Customer owes',
  credit_note: 'Credit note issued in QuickBooks',
};

/** Statuses Finance can act on today (receive, move, delete / credit-note). */
export const ACTIONABLE_STATUSES: StatusKey[] = ['tpg_paid_not_received', 'tpg_completed_no_file', 'paid_elsewhere', 'partial_left', 'cancelled'];

export interface OverdueRow {
  source: SourceKey;
  status: StatusKey;
  amount: number;
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  daysOverdue: number;
  aging: '1-30' | '31-60' | '61-90' | '90+';
  customer: string;
  invoiceBalance: number;
  duplicateNo: boolean;
  in2026: boolean;
  detail: string;
  enrolmentIds: string[];
  grantIds: string[];
  claimIds: string[];
  /** TPG attendance of the row's enrolments — set on "cancelled" rows only (see attachAttendance). */
  attendance?: Array<TpgAttendance & { enrolmentId: string }>;
}

export interface FloatingCredit {
  type: 'Unapplied payment' | 'Open credit note';
  id: string;
  date: string;
  customer: string;
  ref: string;
  amount: number;
  total: number;
}

export interface OverdueBreakdown {
  generatedAt: string;
  today: string;
  overdueTotal: number;
  invoiceCount: number;
  rows: OverdueRow[];
  floatingCredit: FloatingCredit[];
  /** Enrolment statuses read live from TPG by the last "Refresh TPG" (carried into later QuickBooks-only refreshes). */
  liveEnrolmentStatus: LiveEnrolmentStatus;
  /** TPG attendance by enrolment id, carried into later refreshes (only re-read by a TPG check). */
  tpgAttendance?: Record<string, TpgAttendance>;
  tpgDataAsOf: {
    grantFileUpTo: string | null;
    sfcFileUpTo: string | null;
    grantsCheckedAt: string | null;
    claimsCheckedAt: string | null;
    enrolmentsCheckedAt: string | null;
  };
}

export type LiveEnrolmentStatus = Record<string, { status: string; checkedAt: string }>;

const A = (x: any): any[] => (Array.isArray(x) ? x : x ? [x] : []);
const up = (s: unknown) => String(s ?? '').trim().toUpperCase();
const r2 = (n: number) => Math.round(Number(n) * 100) / 100;
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;
const money = (s: unknown) => r2(Number(String(s ?? '').replace(/[$,]/g, '')) || 0);
const isoDay = (d: unknown): string => {
  if (!d) return '';
  if (d instanceof Date) return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
  const s = String(d).trim();
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s.slice(0, 10);
};
const COMPANY_NAME =
  /\b(PTE|LTD|LLP|LIMITED|PRIVATE|CORP|CORPORATION|INC|BHD|SCHOOL|MINISTRY|AUTHORITY|BOARD|COUNCIL|UNIVERSITY|POLYTECHNIC|HOSPITAL|SOCIETY|ASSOCIATION|FOUNDATION|CENTRE|CENTER|AGENCY|GROUP|HOLDINGS|COLLEGE|INSTITUTE|CLINIC|TOWN)\b/i;
const SFC_PAYOUT_REF = /^\d{8,12}$/;

async function qbQueryAll(entity: string, where: string, onPage?: () => void): Promise<any[]> {
  const out: any[] = [];
  for (let start = 1; ; start += 1000) {
    let page: any[] = [];
    for (let attempt = 0; ; attempt++) {
      try {
        const data: any = await callQbProxyData({
          action: 'query',
          entity: entity.toLowerCase(),
          app: 'app1',
          query: `SELECT * FROM ${entity} WHERE ${where} STARTPOSITION ${start} MAXRESULTS 1000`,
        });
        page = data?.QueryResponse?.[entity] ?? [];
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 10000 * (attempt + 1)));
      }
    }
    out.push(...page);
    onPage?.();
    if (page.length < 1000) break;
  }
  return out;
}

type Claim = { claimId: string; status: string; amt: number; payout: string; disb: string };

export async function computeOverdueBreakdown(
  onProgress?: (msg: string) => void,
  liveEnrolmentStatus: LiveEnrolmentStatus = {}
): Promise<OverdueBreakdown> {
  const progress = (m: string) => onProgress?.(m);
  const today = isoDay(new Date());

  // ---- TPG data held in the LMS
  progress('Reading TPG grant / claim records from the LMS…');
  const tpgGrant = new Map<string, Array<{ ref: string; amt: number; date: string }>>();
  let grantFileUpTo = '';
  for (const r of (
    await pool.query(
      `SELECT DISTINCT ON (upper(grant_id), upper(bank_reference_id), amount_parsed)
              upper(grant_id) AS g, upper(bank_reference_id) AS ref, amount_parsed AS amt, payment_date_parsed AS d
         FROM public.grant_import_rows
        WHERE grant_id IS NOT NULL AND bank_reference_id IS NOT NULL AND amount_parsed > 0`
    )
  ).rows) {
    const row = { ref: String(r.ref), amt: r2(r.amt), date: isoDay(r.d) };
    (tpgGrant.get(r.g) || tpgGrant.set(r.g, []).get(r.g)!).push(row);
    if (row.date > grantFileUpTo) grantFileUpTo = row.date;
  }

  const grantDb = new Map<string, { status: string; paid: number; enr: string; es: string }>();
  let grantsCheckedAt = '';
  for (const r of (
    await pool.query(
      `SELECT upper(g.grant_id) AS gid, g.status, g.approved_grant_amount AS paid, upper(g.enrollment_id) AS enr,
              e.enrolment_status AS es, g.imported_at
         FROM public.ssg_grants g
         LEFT JOIN public.ssg_enrolments e ON upper(e.enrolment_id) = upper(g.enrollment_id)`
    )
  ).rows) {
    grantDb.set(r.gid, { status: up(r.status), paid: r2(r.paid ?? 0), enr: r.enr || '', es: r.es || '' });
    const t = r.imported_at ? new Date(r.imported_at).toISOString() : '';
    if (t > grantsCheckedAt) grantsCheckedAt = t;
  }

  // SFC: disbursed only with a payout request id + disbursement date (Bulk SFC uploads, or ssg_claims)
  const disbursed = new Map<string, { payout: string; disb: string; amt: number }>();
  let sfcFileUpTo = '';
  for (const r of (
    await pool.query(
      `SELECT DISTINCT ON (claim_id) claim_id, payout_request_id, disbursement_date_iso, claim_amount
         FROM public.sfc_import_rows
        WHERE claim_id IS NOT NULL AND payout_request_id ~ '^[0-9]+$' AND COALESCE(disbursement_date_iso, '') <> ''
        ORDER BY claim_id, created_at DESC`
    )
  ).rows) {
    const disb = isoDay(r.disbursement_date_iso);
    if (!disb || disb > today) continue;
    disbursed.set(String(r.claim_id), { payout: String(r.payout_request_id), disb, amt: r2(r.claim_amount ?? 0) });
    if (disb > sfcFileUpTo) sfcFileUpTo = disb;
  }
  const claimsByEnr = new Map<string, Array<{ claim_id: string; claim_status: string; claim_amount: number; payout: string; disb: string }>>();
  let claimsCheckedAt = '';
  const hasCheckedCol = (
    await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ssg_claims' AND column_name='tpg_checked_at'`)
  ).rows.length > 0;
  for (const c of (
    await pool.query(
      `SELECT upper(enrollment_id) AS enr, claim_id, claim_status, claim_amount, payout_request_id, disbursement_date
              ${hasCheckedCol ? ', tpg_checked_at' : ', NULL::timestamptz AS tpg_checked_at'}
         FROM public.ssg_claims WHERE enrollment_id IS NOT NULL AND claim_id IS NOT NULL`
    )
  ).rows) {
    (claimsByEnr.get(c.enr) || claimsByEnr.set(c.enr, []).get(c.enr)!).push({
      claim_id: String(c.claim_id),
      claim_status: up(c.claim_status),
      claim_amount: r2(c.claim_amount ?? 0),
      payout: c.payout_request_id ? String(c.payout_request_id) : '',
      disb: isoDay(c.disbursement_date),
    });
    const t = c.tpg_checked_at ? new Date(c.tpg_checked_at).toISOString() : '';
    if (t > claimsCheckedAt) claimsCheckedAt = t;
  }

  const enrByTc = new Map<string, Set<string>>();
  const addEnr = (doc: string, enr: string) => {
    if (!doc || !enr) return;
    (enrByTc.get(doc) || enrByTc.set(doc, new Set()).get(doc)!).add(enr);
  };
  for (const j of (await pool.query(`SELECT upper(enrolment_id) AS enr, upper(qbo_doc_number) AS doc FROM public.invoice_jobs WHERE qbo_doc_number IS NOT NULL`)).rows)
    addEnr(j.doc, j.enr);
  const enrBySfcId = new Map<string, string>();
  const enrBySfcDoc = new Map<string, string>();
  const daEnr = new Set<string>();
  for (const d of (
    await pool.query(`SELECT upper(enrolment_id) AS enr, application_id, sfc_invoice_id, upper(invoice_no) AS inv_no FROM public.da_application WHERE enrolment_id IS NOT NULL`)
  ).rows) {
    if (d.sfc_invoice_id) enrBySfcId.set(String(d.sfc_invoice_id), d.enr);
    if (d.application_id) enrBySfcDoc.set(`SFC-${up(d.application_id)}`, d.enr);
    if (d.application_id && !/^(MANUAL|PENDING)/i.test(String(d.application_id))) daEnr.add(d.enr);
    addEnr(d.inv_no, d.enr);
  }
  const enrStatus = new Map<string, { es: string; sp: string }>();
  for (const r of (await pool.query(`SELECT upper(enrolment_id) AS enr, enrolment_status AS es, sponsorship_type AS sp FROM public.ssg_enrolments`)).rows)
    enrStatus.set(r.enr, { es: r.es || '', sp: r.sp || '' });
  // TPG's live answer wins over the LMS copy, which is not updated when a learner cancels on TPG later.
  let enrolmentsCheckedAt = '';
  for (const [enr, live] of Object.entries(liveEnrolmentStatus)) {
    enrStatus.set(up(enr), { es: live.status, sp: enrStatus.get(up(enr))?.sp || '' });
    if (live.checkedAt > enrolmentsCheckedAt) enrolmentsCheckedAt = live.checkedAt;
  }
  for (const g of grantDb.values()) if (g.enr && liveEnrolmentStatus[g.enr]) g.es = liveEnrolmentStatus[g.enr].status;
  const cancelledEnr = (e: string) => /CANCEL|REMOVED/i.test(enrStatus.get(e)?.es || '');

  const claimState = (enrs: string[]): Claim => {
    const rank = (s: string) => (s === 'DISBURSED' ? 0 : /CANCEL|REJECT|REFUND|LAPSE|WITHDRAW/.test(s) ? 3 : s === 'NONE' ? 4 : 1);
    let best: Claim | null = null;
    for (const e of enrs)
      for (const c of claimsByEnr.get(e) || []) {
        const d = disbursed.get(c.claim_id) || (c.payout && c.disb && c.disb <= today ? { payout: c.payout, disb: c.disb, amt: c.claim_amount } : null);
        const cand: Claim = d
          ? { claimId: c.claim_id, status: 'DISBURSED', amt: d.amt || c.claim_amount, payout: d.payout, disb: d.disb }
          : { claimId: c.claim_id, status: c.claim_status || 'UNKNOWN', amt: c.claim_amount, payout: '', disb: '' };
        if (!best || rank(cand.status) < rank(best.status)) best = cand;
      }
    return best || { claimId: '', status: 'NONE', amt: 0, payout: '', disb: '' };
  };

  // ---- QuickBooks, live
  let pages = 0;
  const tick = (what: string) => () => progress(`Reading QuickBooks ${what}… (${++pages} pages)`);
  const open = await qbQueryAll('Invoice', `Balance > '0'`, tick('open invoices'));
  const overdue = open.filter((i) => i.DueDate && i.DueDate < today);
  const pays = await qbQueryAll('Payment', `TxnDate >= '2025-06-01'`, tick('payments'));
  const recentInv = await qbQueryAll('Invoice', `TxnDate >= '2025-06-01'`, tick('invoices'));
  const unappliedCms = await qbQueryAll('CreditMemo', `Balance > '0'`, tick('credit notes'));
  const recentCms = await qbQueryAll('CreditMemo', `TxnDate >= '2025-06-01'`, tick('credit notes'));
  progress('Matching invoices against TPG…');

  const payById = new Map(pays.map((p) => [String(p.Id), p]));
  const invById = new Map(recentInv.map((i) => [String(i.Id), i]));
  for (const i of open) invById.set(String(i.Id), i);
  const docCount = new Map<string, number>();
  for (const i of recentInv) docCount.set(up(i.DocNumber), (docCount.get(up(i.DocNumber)) || 0) + 1);
  const appliedRefAmt = new Map<string, string[]>();
  for (const p of pays)
    for (const l of A(p.Line))
      for (const t of A(l.LinkedTxn))
        if (t.TxnType === 'Invoice') {
          const k = `${up(p.PaymentRefNum)}|${r2(l.Amount)}`;
          (appliedRefAmt.get(k) || appliedRefAmt.set(k, []).get(k)!).push(String(t.TxnId));
        }
  const textCache = new Map<string, string>();
  const text = (i: any) => {
    const id = String(i?.Id ?? '');
    if (!textCache.has(id)) textCache.set(id, up([i?.DocNumber, ...A(i?.Line).map((l: any) => l.Description || '')].join(' ')));
    return textCache.get(id)!;
  };
  const linked = (i: any) => {
    const out: Array<{ ref: string; amt: number; date: string }> = [];
    const ids = new Set(A(i.LinkedTxn).filter((t: any) => t.TxnType === 'Payment').map((t: any) => String(t.TxnId)));
    for (const pid of ids) {
      const p = payById.get(pid);
      if (!p) continue;
      for (const l of A(p.Line))
        if (A(l.LinkedTxn).some((t: any) => t.TxnType === 'Invoice' && String(t.TxnId) === String(i.Id)))
          out.push({ ref: up(p.PaymentRefNum), amt: r2(l.Amount), date: String(p.TxnDate || '') });
    }
    return out;
  };
  const docsOf = (ids: string[]) => ids.map((id) => invById.get(id)?.DocNumber || id).join(', ');

  const rows: OverdueRow[] = [];
  const add = (i: any, source: SourceKey, status: StatusKey, amount: number, detail: string, ids: { enr?: string[]; grants?: string[]; claims?: string[] } = {}) => {
    if (amount <= 0.004) return;
    const days = Math.round((Date.parse(today) - Date.parse(i.DueDate)) / 864e5);
    rows.push({
      source,
      status,
      amount: r2(amount),
      invoiceId: String(i.Id),
      invoiceNo: String(i.DocNumber || ''),
      invoiceDate: String(i.TxnDate || ''),
      dueDate: String(i.DueDate || ''),
      daysOverdue: days,
      aging: days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+',
      customer: String(i.CustomerRef?.name || ''),
      invoiceBalance: r2(i.Balance),
      duplicateNo: (docCount.get(up(i.DocNumber)) || 0) > 1,
      in2026: String(i.TxnDate || '') >= '2026-01-01',
      detail,
      enrolmentIds: ids.enr || [],
      grantIds: ids.grants || [],
      claimIds: ids.claims || [],
    });
  };

  for (const i of overdue) {
    const doc = up(i.DocNumber);
    const bal = r2(i.Balance);
    const lk = linked(i);

    if (doc.startsWith('GRN-')) {
      const grants = [...new Set(text(i).match(/GRN-\d{4}-\d{6}/g) || [])];
      const enrs = [...new Set(grants.map((g) => grantDb.get(g)?.enr).filter(Boolean) as string[])];
      const ids = { enr: enrs, grants };
      let paidNotRec = 0;
      let completedNoFile = 0;
      let paidElsewhere = 0;
      const notes: string[] = [];
      const unpaid: string[] = [];
      for (const g of grants) {
        const tp = tpgGrant.get(g) || [];
        if (!tp.length) {
          const s = grantDb.get(g);
          if (s?.status === 'COMPLETED' && s.paid > 0 && !lk.some((x) => eq(x.amt, s.paid) && x.ref.startsWith('FTB'))) {
            completedNoFile += s.paid;
            notes.push(`${g} TPG Completed, paid $${s.paid} — upload the latest TPG Financial Transaction Report in Bulk Grant Payment Sync to receive it`);
          } else unpaid.push(g);
          continue;
        }
        for (const t of tp) {
          if (lk.some((x) => x.ref === t.ref && eq(x.amt, t.amt))) continue;
          const elsewhere = (appliedRefAmt.get(`${t.ref}|${t.amt}`) || []).filter((id) => id !== String(i.Id) && text(invById.get(id)).includes(g));
          if (elsewhere.length) {
            paidElsewhere += t.amt;
            notes.push(`${g} $${t.amt} (${t.ref}) already on ${docsOf(elsewhere)}`);
          } else {
            paidNotRec += t.amt;
            notes.push(`${g} TPG paid $${t.amt} ${t.ref} on ${t.date}`);
          }
        }
      }
      let rest = bal;
      const take = (status: StatusKey, amt: number, detail: string) => {
        const a = Math.min(rest, amt);
        add(i, 'grn', status, a, detail, ids);
        rest = r2(rest - a);
      };
      take('tpg_paid_not_received', paidNotRec, notes.join('; '));
      take('tpg_completed_no_file', completedNoFile, notes.join('; '));
      take('paid_elsewhere', paidElsewhere, notes.join('; '));
      if (rest > 0.004) {
        const st = unpaid.map((g) => grantDb.get(g));
        const sts = st.map((s) => s?.status || 'NO RECORD');
        const det = unpaid.map((g, k) => `${g}: ${sts[k]}${st[k]?.es ? ` (enrolment ${st[k]!.es})` : ''}`).join('; ');
        const allPaid = grants.length > 0 && unpaid.length === 0;
        const status: StatusKey = allPaid
          ? 'partial_left'
          : !grants.length
            ? 'check'
            : (sts.length && sts.every((s) => s === 'CANCELLED')) || st.some((s) => /CANCEL|REMOVED/i.test(s?.es || ''))
              ? 'cancelled'
              : sts.some((s) => ['PENDING PAYMENT', 'GRANT PROCESSING', 'PENDING REVIEW'].includes(s))
                ? 'waiting_tpg'
                : 'check';
        // A grant cancelled while the enrolment is still Confirmed is flagged, not assumed — the learner may still be attending.
        const activeEnrolment = status === 'cancelled' && st.some((s) => s?.status === 'CANCELLED' && /CONFIRM/i.test(s?.es || ''));
        add(
          i,
          'grn',
          status,
          rest,
          [
            activeEnrolment ? 'ACTIVE ENROLMENT, CANCELLED GRANT — check with the course team before deleting' : '',
            det,
            allPaid ? notes.join('; ') : '',
            !grants.length ? 'No "Grant Ref #" found on the invoice' : '',
          ]
            .filter(Boolean)
            .join('; '),
          ids
        );
      }
    } else if (doc.startsWith('SFC-CA-')) {
      const enr = enrBySfcId.get(String(i.Id)) || enrBySfcDoc.get(doc.replace(/-R\d+$/, '')) || '';
      const c = claimState(enr ? [enr] : []);
      const es = enrStatus.get(enr)?.es || '';
      const recHere = !!c.payout && lk.some((x) => x.ref === up(c.payout));
      const elsewhere = c.payout ? (appliedRefAmt.get(`${up(c.payout)}|${c.amt}`) || []).filter((id) => id !== String(i.Id)) : [];
      const status: StatusKey = !enr
        ? 'check'
        : c.status === 'DISBURSED' && !recHere && elsewhere.length
          ? 'paid_elsewhere'
          : c.status === 'DISBURSED' && !recHere
            ? 'tpg_paid_not_received'
            : c.status === 'DISBURSED'
              ? 'partial_left'
              : /CANCEL|REJECT|REFUND|LAPSE|WITHDRAW/.test(c.status) || /CANCEL|REMOVED/i.test(es)
                ? 'cancelled'
                : c.status === 'NONE'
                  ? 'check'
                  : 'waiting_tpg';
      const detail = !enr
        ? 'SFC-CA invoice not linked to any Direct Application in the LMS'
        : `${enr} · claim ${c.claimId || '—'} ${c.status} $${c.amt}${c.payout ? ` · payout ${c.payout} on ${c.disb}` : ''}${es ? ` · enrolment ${es}` : ''}${elsewhere.length ? ` · already on ${docsOf(elsewhere)}` : ''}`;
      add(i, 'sfc_ca', status, bal, detail, { enr: enr ? [enr] : [], claims: c.claimId ? [c.claimId] : [] });
    } else if (doc.startsWith('TC')) {
      const enrs = [...(enrByTc.get(doc) || [])];
      const company = COMPANY_NAME.test(i.CustomerRef?.name || '') || enrs.some((e) => /EMPLOYER/i.test(enrStatus.get(e)?.sp || ''));
      const cancelled = enrs.length > 0 && enrs.every(cancelledEnr);
      let rest = bal;
      // Non-DA SFC sits on the TC as a "To Less SkillsFuture Credit: $x" note line; TPG's payout is received on the TC.
      const sfcNote = A(i.Line)
        .map((l: any) => String(l.Description || ''))
        .find((d: string) => /To Less SkillsFuture Credit/i.test(d));
      const sfcAmt = sfcNote ? money((sfcNote.match(/\$\s*([\d,]+(?:\.\d+)?)/) || [])[1]) : 0;
      if (sfcAmt > 0) {
        const sfcRec = lk.filter((x) => SFC_PAYOUT_REF.test(x.ref)).reduce((s, x) => s + x.amt, 0);
        const sOpen = Math.min(rest, Math.max(0, r2(sfcAmt - sfcRec)));
        const nonDa = enrs.filter((e) => !daEnr.has(e));
        const c = claimState(nonDa);
        const elsewhere = c.payout ? (appliedRefAmt.get(`${up(c.payout)}|${c.amt}`) || []).filter((id) => id !== String(i.Id)) : [];
        const status: StatusKey =
          c.status === 'DISBURSED' && elsewhere.length
            ? 'paid_elsewhere'
            : c.status === 'DISBURSED'
              ? 'tpg_paid_not_received'
              : /CANCEL|REJECT|REFUND|LAPSE|WITHDRAW/.test(c.status)
                ? 'cancelled'
                : c.status === 'NONE'
                  ? 'check'
                  : 'waiting_tpg';
        add(
          i,
          'sfc_tc',
          status,
          sOpen,
          `SFC on TC $${sfcAmt}, received $${r2(sfcRec)} · claim ${c.claimId || '— (none in LMS)'} ${c.status} $${c.amt}${c.payout ? ` · payout ${c.payout} on ${c.disb}` : ''}${elsewhere.length ? ` · already on ${docsOf(elsewhere)}` : ''}`,
          { enr: nonDa, claims: c.claimId ? [c.claimId] : [] }
        );
        rest = r2(rest - sOpen);
      }
      const paid = lk.length ? ` · paid so far: ${lk.map((x) => `${x.ref || 'no ref'} $${x.amt} (${x.date})`).join('; ')}` : '';
      const someCancelled = !cancelled && enrs.some(cancelledEnr) ? ` · cancelled on TPG: ${enrs.filter(cancelledEnr).join(', ')}` : '';
      add(i, company ? 'company_tc' : 'individual_tc', cancelled ? 'cancelled' : 'customer_owes', rest, `${enrs.join(', ') || 'Not linked to an LMS enrolment'}${someCancelled}${paid}`, { enr: enrs });
    } else {
      add(i, 'other', 'customer_owes', bal, '');
    }
  }

  // A credit note already raised for an invoice settles it from Finance's side even while the invoice
  // still shows a balance: mark those rows "credit note issued" instead of an action. A credit note
  // counts when its number or text cites the invoice number; for a GRN invoice also when it cites one
  // of the invoice's grants (company TC credit notes list every learner's "Grant Ref #"). TC and
  // SFC-CA invoices match on their own number only — their lines cite grants too, which would pull
  // in other learners. While TPG is still processing / paying the grant or claim ("waiting"), the
  // invoice still expects TPG's money, so it keeps that status and only gets a note: a learner's TC
  // credit note reverses the TC's grant lines too, which does not mean TPG will not pay.
  const cnByRef = new Map<string, Array<{ doc: string; date: string; customer: string; total: number }>>();
  const REF = /GRN-\d{4}-\d{6}|SFC-CA-\d{4}-\d{6}(?:-R\d+)?|\bTC\d{2}-\d{4}-[0-9A-Z]+(?:-R\d+)?/g;
  for (const cm of recentCms) {
    const cmText = up([cm.DocNumber, cm.PrivateNote, cm.CustomerMemo?.value, ...A(cm.Line).map((l: any) => l.Description || '')].join(' ')).replace(/`/g, '');
    const note = { doc: String(cm.DocNumber || cm.Id), date: String(cm.TxnDate || ''), customer: String(cm.CustomerRef?.name || ''), total: r2(cm.TotalAmt) };
    for (const ref of new Set(cmText.match(REF) || [])) (cnByRef.get(ref) || cnByRef.set(ref, []).get(ref)!).push(note);
  }
  for (const row of rows) {
    const refs = [up(row.invoiceNo), ...(row.source === 'grn' ? row.grantIds : [])];
    const hits = new Map<string, { note: { doc: string; date: string; customer: string; total: number }; ref: string }>();
    for (const ref of refs) for (const note of cnByRef.get(ref) || []) if (!hits.has(note.doc)) hits.set(note.doc, { note, ref });
    if (!hits.size) continue;
    const cited = [...hits.values()]
      .map(({ note, ref }) => `Credit note ${note.doc} (${note.customer}, ${note.date}, $${note.total}) cites ${ref}`)
      .join('; ');
    if (row.status === 'waiting_tpg') {
      row.detail = `${row.detail} · Note: ${cited} — TPG has not paid yet, so it stays open`;
    } else {
      row.status = 'credit_note';
      row.detail = `${cited} · was: ${row.detail}`;
    }
  }

  const floatingCredit: FloatingCredit[] = [
    ...pays
      .filter((p) => Number(p.UnappliedAmt) > 0.004)
      .map((p) => ({
        type: 'Unapplied payment' as const,
        id: String(p.Id),
        date: String(p.TxnDate || ''),
        customer: String(p.CustomerRef?.name || ''),
        ref: String(p.PaymentRefNum || ''),
        amount: r2(p.UnappliedAmt),
        total: r2(p.TotalAmt),
      })),
    ...unappliedCms.map((c) => ({
      type: 'Open credit note' as const,
      id: String(c.Id),
      date: String(c.TxnDate || ''),
      customer: String(c.CustomerRef?.name || ''),
      ref: String(c.DocNumber || ''),
      amount: r2(c.Balance),
      total: r2(c.TotalAmt),
    })),
  ];

  return {
    generatedAt: new Date().toISOString(),
    today,
    overdueTotal: r2(overdue.reduce((s, i) => s + Number(i.Balance), 0)),
    invoiceCount: overdue.length,
    rows,
    floatingCredit,
    liveEnrolmentStatus,
    tpgDataAsOf: {
      grantFileUpTo: grantFileUpTo || null,
      sfcFileUpTo: sfcFileUpTo || null,
      grantsCheckedAt: grantsCheckedAt || null,
      claimsCheckedAt: claimsCheckedAt || null,
      enrolmentsCheckedAt: enrolmentsCheckedAt || null,
    },
  };
}

/** Enrolments behind the rows TPG cancelled — the ones whose attendance Finance needs to see. */
export function cancelledEnrolmentIds(result: OverdueBreakdown): string[] {
  return [...new Set(result.rows.filter((r) => r.status === 'cancelled').flatMap((r) => r.enrolmentIds.map((e) => up(e))))];
}

/** Put TPG attendance on the cancelled rows and keep the map on the result. */
export function attachAttendance(result: OverdueBreakdown, attendance: Record<string, TpgAttendance>): void {
  result.tpgAttendance = attendance;
  for (const row of result.rows) {
    if (row.status !== 'cancelled') continue;
    const found = row.enrolmentIds
      .map((e) => ({ enrolmentId: up(e), a: attendance[up(e)] }))
      .filter((x) => x.a)
      .map(({ enrolmentId, a }) => ({ enrolmentId, ...a }));
    if (found.length) row.attendance = found;
  }
}
