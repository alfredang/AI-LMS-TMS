import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Card } from '../ui/Card';

interface CourseRunData {
  [key: string]: any;
}

const PAGE_SIZE = 20;

const STICKY_HEAD_BG  = '#2d3748';
const STICKY_ROW_BG   = '#252d3a';
const STICKY_HOVER_BG = '#323c4e';
const NORMAL_HEAD_BG  = '#1e2533';
const NORMAL_ROW_BG   = '#1a2130';
const NORMAL_HOVER_BG = '#1f2a3a';

const enrollmentStatusStyle: Record<string, { bg: string; color: string; label: string }> = {
  confirmed: { bg: '#166534', color: '#bbf7d0', label: 'Confirmed' },
  cancelled: { bg: '#7f1d1d', color: '#fecaca', label: 'Cancelled' },
  error:     { bg: '#1e3a5f', color: '#bfdbfe', label: 'Error' },
};

const grantStatusBLStyle: Record<string, { bg: string; color: string; label: string }> = {
  completed:          { bg: '#166534', color: '#bbf7d0', label: 'Completed' },
  confirmed:          { bg: '#14532d', color: '#86efac', label: 'Confirmed' },
  'grant processing': { bg: '#1e3a5f', color: '#bfdbfe', label: 'Grant Processing' },
  'pending payment':  { bg: '#3b0764', color: '#e9d5ff', label: 'Pending Payment' },
  cancelled:          { bg: '#7f1d1d', color: '#fecaca', label: 'Cancelled' },
  'na (ibf)':         { bg: '#374151', color: '#d1d5db', label: 'NA (IBF)' },
};

const grantStatusMCESStyle: Record<string, { bg: string; color: string; label: string }> = {
  completed:          { bg: '#166534', color: '#bbf7d0', label: 'Completed' },
  'grant processing': { bg: '#1e3a5f', color: '#bfdbfe', label: 'Grant Processing' },
  'pending payment':  { bg: '#3b0764', color: '#e9d5ff', label: 'Pending Payment' },
  cancelled:          { bg: '#7f1d1d', color: '#fecaca', label: 'Cancelled' },
  na:                 { bg: '#374151', color: '#d1d5db', label: 'NA' },
};

const tgPaymentStatusStyle: Record<string, { bg: string; color: string; label: string }> = {
  paid:      { bg: '#166534', color: '#bbf7d0', label: 'Paid' },
  unpaid:    { bg: '#7f1d1d', color: '#fecaca', label: 'Unpaid' },
  cancelled: { bg: '#3b0764', color: '#e9d5ff', label: 'Cancelled' },
};

const sfcPaymentStatusStyle: Record<string, { bg: string; color: string; label: string }> = {
  paid:      { bg: '#166534', color: '#bbf7d0', label: 'Paid' },
  pending:   { bg: '#1e3a5f', color: '#bfdbfe', label: 'Pending' },
  approved:  { bg: '#431407', color: '#fed7aa', label: 'Approved' },
  draft:     { bg: '#1f2937', color: '#9ca3af', label: 'Draft' },
  submitted: { bg: '#713f12', color: '#fef08a', label: 'Submitted' },
  cancelled: { bg: '#7f1d1d', color: '#fecaca', label: 'Cancelled' },
  rejected:  { bg: '#0c4a6e', color: '#bae6fd', label: 'Rejected' },
  suspended: { bg: '#134e4a', color: '#99f6e4', label: 'Suspended' },
  refunded:  { bg: '#3b0764', color: '#e9d5ff', label: 'Refunded' },
  na:        { bg: '#374151', color: '#d1d5db', label: 'NA' },
};

const qbSFCStatusStyle: Record<string, { bg: string; color: string; label: string }> = {
  paid:   { bg: '#166534', color: '#bbf7d0', label: 'Paid' },
  unpaid: { bg: '#7f1d1d', color: '#fecaca', label: 'Unpaid' },
  na:     { bg: '#374151', color: '#d1d5db', label: 'NA' },
};

const assessmentStyle: Record<string, { bg: string; color: string; label: string }> = {
  pass:       { bg: '#166534', color: '#bbf7d0', label: 'Pass' },
  fail:       { bg: '#7f1d1d', color: '#fecaca', label: 'Fail' },
  reschedule: { bg: '#1e3a5f', color: '#bfdbfe', label: 'Reschedule' },
};

const assessmentUpdateStyle: Record<string, { bg: string; color: string; label: string }> = {
  completed: { bg: '#166534', color: '#bbf7d0', label: 'Completed' },
  error:     { bg: '#7f1d1d', color: '#fecaca', label: 'Error' },
};

const paymentTypeStyle: Record<string, { bg: string; color: string; label: string }> = {
  company:     { bg: '#166534', color: '#bbf7d0', label: 'Company' },
  cash:        { bg: '#431407', color: '#fed7aa', label: 'Cash' },
  sfc:         { bg: '#1f2937', color: '#9ca3af', label: 'SFC' },
  psea:        { bg: '#7f1d1d', color: '#fecaca', label: 'PSEA' },
  'e-invoice': { bg: '#1e3a5f', color: '#bfdbfe', label: 'e-Invoice' },
  na:          { bg: '#374151', color: '#d1d5db', label: 'NA' },
};

const qbNetFeeStatusStyle: Record<string, { bg: string; color: string; label: string }> = {
  paid:        { bg: '#166534', color: '#bbf7d0', label: 'Paid' },
  unpaid:      { bg: '#7f1d1d', color: '#fecaca', label: 'Unpaid' },
  'not found': { bg: '#374151', color: '#d1d5db', label: 'Not Found' },
  cancelled:   { bg: '#7f1d1d', color: '#fecaca', label: 'Cancelled' },
};

const qbTGStatusStyle: Record<string, { bg: string; color: string; label: string }> = {
  paid:        { bg: '#166534', color: '#bbf7d0', label: 'Paid' },
  unpaid:      { bg: '#7f1d1d', color: '#fecaca', label: 'Unpaid' },
  'not found': { bg: '#374151', color: '#d1d5db', label: 'Not Found' },
  cancelled:   { bg: '#7f1d1d', color: '#fecaca', label: 'Cancelled' },
};

const courseTypeStyle: Record<string, { bg: string; color: string; label: string }> = {
  wsq: { bg: '#166534', color: '#bbf7d0', label: 'WSQ' },
  ibf: { bg: '#431407', color: '#fed7aa', label: 'IBF' },
};

type StatusStyleMap = Record<string, { bg: string; color: string; label: string }>;

const COLUMN_DROPDOWN_OPTIONS: Record<string, string[]> = {
  enrollmentStatus: ['Confirmed', 'Cancelled', 'Error'],
  grantStatusBL:    ['Completed', 'Confirmed', 'Grant Processing', 'Pending Payment', 'Cancelled', 'NA (IBF)'],
  grantStatusMCES:  ['Completed', 'Grant Processing', 'Pending Payment', 'Cancelled', 'NA'],
  tgPaymentStatus:  ['Paid', 'Unpaid', 'Cancelled'],
  sfcPaymentStatus: ['Paid', 'Pending', 'Approved', 'Submitted', 'Cancelled', 'Rejected', 'Suspended', 'Refunded', 'NA'],
  qbSFCStatus:      ['Paid', 'Unpaid', 'NA'],
  assessment:       ['Pass', 'Fail', 'Reschedule'],
  assessmentUpdate: ['Completed', 'Error'],
  paymentType:      ['Cash', 'Company', 'SFC', 'PSEA', 'e-Invoice', 'NA'],
  qbNetFeeStatus:   ['Paid', 'Unpaid', 'Not Found', 'Cancelled'],
  qbTGStatus:       ['Paid', 'Unpaid', 'Not Found', 'Cancelled'],
  courseType:       ['WSQ', 'IBF'],
  terms:            ['25 Days SFC', '30 Days Term', '35 Days Term', '45 Days Term', '60 Days Term', '7 Days', 'COD', 'Due on Receipt', '120 Days Term', '14 Days Term', '15 Days Term', '20 Days SFC/WSQ'],
};

const COLUMN_STYLE_MAP: Record<string, StatusStyleMap> = {
  enrollmentStatus: enrollmentStatusStyle,
  grantStatusBL:    grantStatusBLStyle,
  grantStatusMCES:  grantStatusMCESStyle,
  tgPaymentStatus:  tgPaymentStatusStyle,
  sfcPaymentStatus: sfcPaymentStatusStyle,
  qbSFCStatus:      qbSFCStatusStyle,
  assessment:       assessmentStyle,
  assessmentUpdate: assessmentUpdateStyle,
  paymentType:      paymentTypeStyle,
  qbNetFeeStatus:   qbNetFeeStatusStyle,
  qbTGStatus:       qbTGStatusStyle,
  courseType:       courseTypeStyle,
  terms:            {},
};

// ── Portal dropdown menu ──────────────────────────────────────────────────
const DropdownMenu: React.FC<{
  anchorRect: DOMRect;
  options: string[];
  currentValue: string;
  styleMap: StatusStyleMap;
  onSelect: (val: string) => void;
  onClose: () => void;
}> = ({ anchorRect, options, currentValue, styleMap, onSelect, onClose }) => {
  const menuRef     = useRef<HTMLDivElement>(null);
  const MENU_WIDTH  = 200;
  const ITEM_HEIGHT = 36;
  const PADDING     = 8;
  const maxVisible  = Math.min(options.length, 8);
  const menuHeight  = maxVisible * ITEM_HEIGHT + PADDING * 2;

  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const top  = spaceBelow >= menuHeight + 8 ? anchorRect.bottom + 4 : anchorRect.top - menuHeight - 4;
  const left = Math.min(anchorRect.left, window.innerWidth - MENU_WIDTH - 8);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed', top, left, width: MENU_WIDTH, zIndex: 99999,
        backgroundColor: '#1e2533',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        padding: `${PADDING}px 0`,
        maxHeight: maxVisible * ITEM_HEIGHT + PADDING * 2,
        overflowY: options.length > 8 ? 'auto' : 'visible',
      }}
      onClick={e => e.stopPropagation()}
    >
      {options.map(opt => {
        const optKey   = opt.toLowerCase();
        const optStyle = styleMap[optKey];
        const isActive = optKey === currentValue.toLowerCase();
        return (
          <div
            key={opt}
            onMouseDown={e => { e.preventDefault(); onSelect(opt); onClose(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0 12px', height: ITEM_HEIGHT, cursor: 'pointer',
              backgroundColor: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
              transition: 'background-color 0.1s',
            }}
            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(255,255,255,0.05)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = isActive ? 'rgba(255,255,255,0.08)' : 'transparent'; }}
          >
            <span style={{ width: 14, flexShrink: 0, color: '#60a5fa', fontSize: '0.75rem' }}>
              {isActive ? '✓' : ''}
            </span>
            {optStyle ? (
              <span style={{ backgroundColor: optStyle.bg, color: optStyle.color, padding: '2px 10px', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                {optStyle.label}
              </span>
            ) : (
              <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>{opt}</span>
            )}
          </div>
        );
      })}
    </div>,
    document.body
  );
};

// ── DropdownBadge ─────────────────────────────────────────────────────────
const DropdownBadge: React.FC<{
  value: string;
  styleMap: StatusStyleMap;
  options: string[];
  onChange: (next: string) => void;
}> = ({ value, styleMap, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const pillRef         = useRef<HTMLSpanElement>(null);

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (pillRef.current) setRect(pillRef.current.getBoundingClientRect());
    setOpen(o => !o);
  }, []);

  const handleClose = useCallback(() => setOpen(false), []);

  const key     = value.toLowerCase();
  const style   = styleMap[key];
  const isEmpty = !value || value === '-';

  return (
    <>
      <span
        ref={pillRef}
        onClick={handleOpen}
        style={{
          padding: '2px 8px 2px 10px',
          borderRadius: 9999,
          fontSize: '0.75rem',
          fontWeight: 500,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: style ? style.bg : 'rgba(255,255,255,0.08)',
          color:           style ? style.color : 'rgba(255,255,255,0.45)',
          border: open ? '1px solid rgba(255,255,255,0.3)' : '1px solid transparent',
          transition: 'border-color 0.15s',
        }}
      >
        {isEmpty
          ? <span style={{ opacity: 0.4, fontSize: '0.75rem' }}>—</span>
          : (style ? style.label : value)
        }
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ opacity: 0.65, flexShrink: 0, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>

      {open && rect && (
        <DropdownMenu
          anchorRect={rect}
          options={options}
          currentValue={value}
          styleMap={styleMap}
          onSelect={onChange}
          onClose={handleClose}
        />
      )}
    </>
  );
};

const AllCourseRunsView: React.FC = () => {
  const [data, setData]             = useState<CourseRunData[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [page, setPage]             = useState(0);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [overrides, setOverrides]   = useState<Record<number, Record<string, string>>>({});

  const columns = [
    { key: 'courseRun',           label: 'Course Run',                  sticky: true,  width: 110 },
    { key: 'courseCode',          label: 'Course Code',                 sticky: true,  width: 140 },
    { key: 'courseTitle',         label: 'Course Title',                sticky: true,  width: 320 },
    { key: 'startDate',           label: 'Start Date',                  sticky: true,  width: 110 },
    { key: 'endDate',             label: 'End Date',                    sticky: true,  width: 110 },
    { key: 'traineeName',         label: 'Trainee Name',                sticky: false, width: 160 },
    { key: 'traineeEmail',        label: 'Trainee Email',               sticky: false, width: 200 },
    { key: 'traineeContactNo',    label: 'Trainee Contact No.',         sticky: false, width: 150 },
    { key: 'traineeId',           label: 'Trainee ID',                  sticky: false, width: 130 },
    { key: 'traineeDOB',          label: 'Trainee DOB',                 sticky: false, width: 120 },
    { key: 'sponsorshipType',     label: 'Sponsorship Type',            sticky: false, width: 150 },
    { key: 'employerUEN',         label: 'UEN of Employer',             sticky: false, width: 140 },
    { key: 'employerCompany',     label: 'Employer Company',            sticky: false, width: 180 },
    { key: 'employerContactNo',   label: 'Employer Contact No.',        sticky: false, width: 160 },
    { key: 'employerName',        label: 'Employer Name',               sticky: false, width: 150 },
    { key: 'employerEmail',       label: 'Employer Email',              sticky: false, width: 200 },
    { key: 'enrollmentStatus',    label: 'Enrollment Status',           sticky: false, width: 150 },
    { key: 'enrollmentId',        label: 'Enrollment ID',               sticky: false, width: 130 },
    { key: 'grantApplicationDate',label: 'Grant Application Date',      sticky: false, width: 170 },
    { key: 'grantStatusBL',       label: 'Grant Status (BL)',           sticky: false, width: 150 },
    { key: 'grantIdBL',           label: 'Grant ID (BL)',               sticky: false, width: 140 }, // ✅ new column
    { key: 'amountBL',            label: 'Amount (BL)',                 sticky: false, width: 120 },
    { key: 'grantStatusMCES',     label: 'Grant Status (MCES/SME/IBF)', sticky: false, width: 200 },
    { key: 'grantIdMCES',         label: 'Grant ID (MCES/SME)',         sticky: false, width: 160 },
    { key: 'fundingSchemeCode',   label: 'Funding Scheme Code',         sticky: false, width: 160 },
    { key: 'amountMCES',          label: 'Amount (MCES/SME)',           sticky: false, width: 150 },
    { key: 'totalTGAmount',       label: 'Total TG Amount',             sticky: false, width: 140 },
    { key: 'tgPaymentStatus',     label: 'TG Payment Status',           sticky: false, width: 150 },
    { key: 'sfcClaimId',          label: 'SFC Claim ID',                sticky: false, width: 130 },
    { key: 'sfcAmount',           label: 'SFC Amount',                  sticky: false, width: 120 },
    { key: 'sfcPaymentDate',      label: 'SFC Payment Date',            sticky: false, width: 140 },
    { key: 'sfcPayoutRequestId',  label: 'SFC Payout Request ID',       sticky: false, width: 170 },
    { key: 'sfcApplicationId',    label: 'SFC Application ID',          sticky: false, width: 160 },
    { key: 'sfcPaymentStatus',    label: 'SFC Payment Status',          sticky: false, width: 150 },
    { key: 'qbSFCInvoiceNum',     label: 'QB SFC Invoice Num',          sticky: false, width: 160 },
    { key: 'qbSFCInvoiceAmount',  label: 'QB SFC Invoice Amount',       sticky: false, width: 170 },
    { key: 'qbSFCStatus',         label: 'QB SFC Status',               sticky: false, width: 130 },
    { key: 'tgPaymentDate',       label: 'TG Payment Date',             sticky: false, width: 140 },
    { key: 'financialTxnIdBL',    label: 'Financial Txn ID (BL)',       sticky: false, width: 170 },
    { key: 'financialTxnIdMCES',  label: 'Financial Txn ID (MCES/SME)', sticky: false, width: 200 },
    { key: 'assessment',          label: 'Assessment',                  sticky: false, width: 120 },
    { key: 'feeCollectionStatus', label: 'Fee Collection Status',       sticky: false, width: 170 },
    { key: 'assessmentId',        label: 'Assessment ID',               sticky: false, width: 130 },
    { key: 'assessmentDate',      label: 'Assessment Date',             sticky: false, width: 140 },
    { key: 'skillCode',           label: 'Skill Code',                  sticky: false, width: 120 },
    { key: 'assessmentUpdate',    label: 'Assessment Update',           sticky: false, width: 160 },
    { key: 'qbInvoiceNetFee',     label: 'QB Invoice # (Net Fee)',      sticky: false, width: 170 },
    { key: 'qbNetFeeAmount',      label: 'QB Net Fee Amount',           sticky: false, width: 150 },
    { key: 'paymentType',         label: 'Payment Type',                sticky: false, width: 130 },
    { key: 'qbNetFeeStatus',      label: 'QB Net Fee Status',           sticky: false, width: 140 },
    { key: 'qbInvoiceGrant',      label: 'QB Invoice # (Grant)',        sticky: false, width: 160 },
    { key: 'qbTGStatus',          label: 'QB TG Status',                sticky: false, width: 130 },
    { key: 'bankRefIdBL',         label: 'Bank Ref ID (BL)',            sticky: false, width: 150 },
    { key: 'courseFees',          label: 'Course Fees',                 sticky: false, width: 120 },
    { key: 'bankRefIdMCES',       label: 'Bank Ref ID (MCES/SME)',      sticky: false, width: 170 },
    { key: 'courseType',          label: 'Course Type',                 sticky: false, width: 130 },
    { key: 'invoiceNo',           label: 'Invoice No.',                 sticky: false, width: 130 },
    { key: 'paybySFC',            label: 'Pay by SFC',                  sticky: false, width: 110 },
    { key: 'terms',               label: 'Terms',                       sticky: false, width: 160 },
    { key: 'payableFees',         label: 'Payable Fees',                sticky: false, width: 120 }, // ✅ fixed broken line
    { key: 'invoiceCreation',     label: 'Invoice Creation',            sticky: false, width: 150 },
  ];

  const stickyOffsets: Record<string, number> = {};
  let offset = 0;
  for (const col of columns.filter(c => c.sticky)) {
    stickyOffsets[col.key] = offset;
    offset += col.width;
  }

  const formatValue = (value: any): string => {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const getCellValue = (rowIdx: number, colKey: string, row: CourseRunData): string =>
    overrides[rowIdx]?.[colKey] ?? formatValue(row[colKey]);

  const handleOverride = (rowIdx: number, colKey: string, next: string) => {
    setOverrides(prev => ({
      ...prev,
      [rowIdx]: { ...(prev[rowIdx] ?? {}), [colKey]: next },
    }));
  };

  const renderCell = (col: typeof columns[0], row: CourseRunData, rowIdx: number) => {
    const options  = COLUMN_DROPDOWN_OPTIONS[col.key];
    const styleMap = COLUMN_STYLE_MAP[col.key];
    const cellVal  = getCellValue(rowIdx, col.key, row);

    if (options) {
      return (
        <DropdownBadge
          value={cellVal}
          styleMap={styleMap ?? {}}
          options={options}
          onChange={next => handleOverride(rowIdx, col.key, next)}
        />
      );
    }

    return formatValue(row[col.key]);
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/training-provider/course-runs');
        if (!response.ok) throw new Error('Failed to fetch course runs');
        const json = await response.json();
        setData(json.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter(row =>
      columns.some(col => formatValue(row[col.key]).toLowerCase().includes(q))
    );
  }, [data, search]);

  useEffect(() => { setPage(0); }, [search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageData   = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-on-surface">All Course Runs</h2>

      <Card className="p-3">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M10.0007 8.93922L12.7822 11.7208L11.7215 12.7815L8.93993 10.0001C8.02659 10.7307 6.86992 11.1667 5.61325 11.1667C2.71992 11.1667 0.379883 8.82669 0.379883 5.93335C0.379883 3.04002 2.71992 0.700012 5.61325 0.700012C8.50659 0.700012 10.8466 3.04002 10.8466 5.93335C10.8466 7.19002 10.4106 8.34589 10.0007 8.93922ZM8.83238 8.48754C9.55992 7.72335 9.96325 6.70085 9.96325 5.93335C9.96325 3.52669 8.01992 1.58335 5.61325 1.58335C3.20659 1.58335 1.26325 3.52669 1.26325 5.93335C1.26325 8.34002 3.20659 10.2834 5.61325 10.2834C6.38075 10.2834 7.40325 9.88004 8.16742 9.15254L8.83238 8.48754Z" fill="currentColor"/>
          </svg>
          <input
            type="text"
            placeholder="Search by course run, course code, title, trainee name, enrollment ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-surface border border-default rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-on-surface placeholder-gray-400"
          />
        </div>
      </Card>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-12 text-center flex items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
            <p className="text-on-surface-secondary">Loading course runs...</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="text-sm" style={{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    {columns.map(col => (
                      <th
                        key={col.key}
                        style={{
                          width: col.width, minWidth: col.width, maxWidth: col.width,
                          backgroundColor: col.sticky ? STICKY_HEAD_BG : NORMAL_HEAD_BG,
                          ...(col.sticky ? { position: 'sticky', left: stickyOffsets[col.key], zIndex: 2 } : {}),
                          borderBottom: '1px solid rgba(255,255,255,0.08)',
                          borderRight: col.key === 'endDate' ? '2px solid rgba(255,255,255,0.2)' : undefined,
                        }}
                        className="px-4 py-3 text-left font-medium text-on-surface-secondary whitespace-nowrap overflow-hidden text-ellipsis"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageData.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length} className="px-4 py-12 text-center text-on-surface-secondary" style={{ backgroundColor: NORMAL_ROW_BG }}>
                        No records found.
                      </td>
                    </tr>
                  ) : (
                    pageData.map((row, rowIdx) => {
                      const isHovered = hoveredRow === rowIdx;
                      return (
                        <tr key={rowIdx} onMouseEnter={() => setHoveredRow(rowIdx)} onMouseLeave={() => setHoveredRow(null)}>
                          {columns.map(col => (
                            <td
                              key={col.key}
                              style={{
                                width: col.width, minWidth: col.width, maxWidth: col.width,
                                backgroundColor: col.sticky
                                  ? isHovered ? STICKY_HOVER_BG : STICKY_ROW_BG
                                  : isHovered ? NORMAL_HOVER_BG : NORMAL_ROW_BG,
                                ...(col.sticky ? { position: 'sticky', left: stickyOffsets[col.key], zIndex: 1 } : {}),
                                borderBottom: '1px solid rgba(255,255,255,0.06)',
                                borderRight: col.key === 'endDate' ? '2px solid rgba(255,255,255,0.2)' : undefined,
                                transition: 'background-color 0.1s',
                              }}
                              className={`px-4 py-3 text-on-surface whitespace-nowrap ${
                                COLUMN_DROPDOWN_OPTIONS[col.key]
                                  ? 'overflow-visible'
                                  : 'overflow-hidden text-ellipsis'
                              }`}
                            >
                              {renderCell(col, row, rowIdx)}
                            </td>
                          ))}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-default bg-surface-elevated">
              <div className="text-sm text-on-surface-secondary">
                {filtered.length === 0
                  ? 'No records'
                  : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length.toLocaleString()}`}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(0)} disabled={page === 0} className="px-3 py-1.5 text-sm rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-surface transition-colors">First</button>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 text-sm rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-surface transition-colors">Previous</button>
                <span className="text-sm text-on-surface-secondary px-1">Page {page + 1} of {totalPages.toLocaleString()}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1.5 text-sm rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-surface transition-colors">Next</button>
                <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-3 py-1.5 text-sm rounded-md border border-default bg-surface hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed text-on-surface transition-colors">Last</button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default AllCourseRunsView;