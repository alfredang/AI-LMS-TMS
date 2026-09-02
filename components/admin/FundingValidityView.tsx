import React, { useMemo, useRef, useState } from 'react';
import { useDeveloperCourses } from '@hooks/useDeveloperCourses';
import { Card } from '../ui/Card';
import { getLocalYMD } from '@/lib/dateHelpers';
import { apiClient } from '@lib/services/apiClient';
import {
  classifyRenewStatus,
  isKnownRenewStatus,
  RENEW_STATUS_OPTIONS,
  renewStatusLabel,
  type RenewClass,
} from '@lib/courseRenewalStatus';

const FOUR_MONTHS_AHEAD = (date: Date) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 4);
  return next;
};

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const parseValidityDate = (value?: string | null) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const formatValidityDate = (value?: string | null) => {
  const date = parseValidityDate(value);
  return date ? date.toLocaleDateString('en-GB') : 'N/A';
};

// Convert validity string to YYYY-MM-DD for date input
const toDateInputValue = (value?: string | null) => {
  const date = parseValidityDate(value);
  if (!date) return '';
  return getLocalYMD(date);
};

const isRenewed = (value?: string | null) => !!value && value.trim().length > 0;

// Which pill an expiring / expired funded course shows.
//
// 'Approved / Renewed' does NOT clear the warning: an approved renewal comes with
// a new validity end date, so a course that is still counting down has either not
// had that date keyed in yet or is carrying a stale flag from an earlier round.
// Either way it still needs a human, so it keeps Expiring Soon and explains
// itself on hover.
const validityPill = (renewClass: RenewClass, expired: boolean): { text: string; cls: string; title?: string } => {
  if (renewClass === 'Waiting') {
    return { text: 'Renewal Pending', cls: 'text-blue-600 dark:text-blue-400', title: 'Renewal submitted — waiting on SSG approval' };
  }
  if (renewClass === 'Rejected') {
    return { text: 'Renewal Rejected', cls: 'text-red-600 dark:text-red-400', title: 'The renewal came back rejected' };
  }
  const base = expired
    ? { text: 'Expired', cls: 'text-red-600 dark:text-red-400' }
    : { text: 'Expiring Soon', cls: 'text-amber-600 dark:text-amber-400' };
  if (renewClass === 'ToDo') {
    return { ...base, title: 'Marked "To Renew" — the renewal has not gone to SSG yet.' };
  }
  return renewClass === 'Approved'
    ? { ...base, title: 'Marked "Approved / Renewed", but the funding validity end date has not been extended — either the new date is not keyed in yet, or the status is left over from an earlier renewal.' }
    : base;
};

// Course types are stored literally since the CASL conversion (Aug 2026):
// funded courses are typed WSQ / CASL / IBF (TGS- codes); Non-WSQ (C- codes)
// is unfunded and shows as itself — it is no longer folded into CASL.
const displayCourseType = (value?: string | null) => value || 'Non-WSQ';

// Collapse the stored course_type into the editable buckets. Anything that isn't
// exactly 'WSQ' or 'CASL' (incl. IBF / non-WSQ) is treated as Non-WSQ here.
const normalizeCourseType = (value?: string | null): 'WSQ' | 'CASL' | 'Non-WSQ' =>
  value === 'WSQ' ? 'WSQ' : value === 'CASL' ? 'CASL' : 'Non-WSQ';

interface EditState {
  casScore: string;
  esScore: string;
  fundingValidity: string;
  courseType: 'WSQ' | 'CASL' | 'Non-WSQ';
  newCourseCode: string;
}

const FundingValidityView: React.FC = () => {
  const { courses, loading, error, refetch } = useDeveloperCourses();
  const [renewingIds, setRenewingIds] = useState<Record<string, boolean>>({});
  // Optimistic renewal status per course, held until the refetch lands.
  const [renewStatusOverrides, setRenewStatusOverrides] = useState<Record<string, string | null>>({});
  // Bulk selection — for setting the same Renew Status across many rows, e.g.
  // marking a batch as 'Renewed — Processing' after they go to SSG together.
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [bulkStatus, setBulkStatus] = useState<string>('Waiting For Renewal');
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [whitelistingIds, setWhitelistingIds] = useState<Record<string, boolean>>({});
  const [whitelistStateOverrides, setWhitelistStateOverrides] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ casScore: '', esScore: '', fundingValidity: '', courseType: 'WSQ', newCourseCode: '' });
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<{
    updated: number;
    unchanged: number;
    failed: number;
    results: Array<{ refCode: string; title: string; action: string; message: string }>;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | 'WSQ' | 'CASL' | 'IBF' | 'Non-WSQ'>('All');
  const [endDateFrom, setEndDateFrom] = useState('');
  const [endDateTo, setEndDateTo] = useState('');

  const today = startOfDay(new Date());
  const fourMonthsAhead = startOfDay(FOUR_MONTHS_AHEAD(today));

  const wsqCourses = useMemo(() => {
    return [...(courses || [])]
      .sort((a, b) => {
        const left = parseValidityDate(a.fundingValidity);
        const right = parseValidityDate(b.fundingValidity);
        if (!left && !right) return a.title.localeCompare(b.title);
        if (!left) return 1;
        if (!right) return -1;
        return left.getTime() - right.getTime();
      });
  }, [courses]);

  // Matches on title / both ref codes / type so "WSQ", "TGS-2024" or a course name all work,
  // then narrows by the Type dropdown and the Validity End Date range.
  const visibleCourses = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = endDateFrom ? parseValidityDate(endDateFrom) : null;
    const to = endDateTo ? parseValidityDate(endDateTo) : null;
    return wsqCourses.filter(course => {
      if (term && ![course.title, course.newCourseCode, course.courseCode, displayCourseType(course.courseType)]
        .some(field => (field || '').toLowerCase().includes(term))) return false;
      if (typeFilter !== 'All' && displayCourseType(course.courseType) !== typeFilter) return false;
      if (from || to) {
        const end = parseValidityDate(course.fundingValidity);
        if (!end) return false;
        if (from && end < from) return false;
        if (to && end > to) return false;
      }
      return true;
    });
  }, [search, typeFilter, endDateFrom, endDateTo, wsqCourses]);

  const filtersActive = !!search.trim() || typeFilter !== 'All' || !!endDateFrom || !!endDateTo;

  const expiringSoonIds = useMemo(() => {
    return new Set(
      wsqCourses
        .filter(course => {
          const validityDate = parseValidityDate(course.fundingValidity);
          return validityDate && validityDate >= today && validityDate <= fourMonthsAhead;
        })
        .map(course => course.id)
    );
  }, [fourMonthsAhead, today, wsqCourses]);

  const effectiveRenewStatus = (course: any): string | null => {
    const override = renewStatusOverrides[course.id];
    return override === undefined ? (course.renewedStatus || null) : override;
  };

  const isCourseRenewed = (course: any) => isRenewed(effectiveRenewStatus(course));

  // Row 1 — totals by funding type: WSQ, CASL and IBF each get their own tile.
  // Non-WSQ (unfunded) courses stay out of every tile so these totals match the
  // Course Management KPI cards.
  const typeTotals = { WSQ: 0, CASL: 0, IBF: 0 };
  for (const course of wsqCourses) {
    const t = displayCourseType(course.courseType);
    if (t === 'IBF') typeTotals.IBF += 1;
    else if (t === 'CASL') typeTotals.CASL += 1;
    else if (t === 'WSQ') typeTotals.WSQ += 1;
  }
  const totalFunded = typeTotals.WSQ + typeTotals.CASL + typeTotals.IBF;

  const addMonthsTo = (date: Date, months: number) => {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
  };
  const addDaysTo = (date: Date, days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };

  // Row 2 — cumulative expiry windows: "in 3 months" includes the 2-month,
  // 1-month and 1-week courses, and so on down the row.
  const expiryWindows = [
    { key: '3m', label: 'Expiring in 3 Months', end: startOfDay(addMonthsTo(today, 3)), color: 'text-amber-500' },
    { key: '2m', label: 'Expiring in 2 Months', end: startOfDay(addMonthsTo(today, 2)), color: 'text-orange-500' },
    { key: '1m', label: 'Expiring in 1 Month', end: startOfDay(addMonthsTo(today, 1)), color: 'text-red-500' },
    { key: '1w', label: 'Expiring in 1 Week', end: startOfDay(addDaysTo(today, 7)), color: 'text-purple-600' },
  ].map(window => {
    const inWindow = wsqCourses.filter(course => {
      const validityDate = parseValidityDate(course.fundingValidity);
      return !!validityDate && validityDate >= today && validityDate <= window.end;
    });
    const renewed = inWindow.filter(isCourseRenewed).length;
    return { ...window, total: inWindow.length, renewed };
  });

  // Stacked-bar data — one bucket per calendar month from this month through
  // +6 (e.g. Aug 2026 … Feb 2027): courses whose funding validity ends inside
  // that month, split into renewed vs pending renewal.
  const monthlyExpiry = Array.from({ length: 7 }, (_, i) => {
    const monthStart = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + i + 1, 0, 23, 59, 59);
    const inMonth = wsqCourses.filter(course => {
      const validityDate = parseValidityDate(course.fundingValidity);
      return !!validityDate && validityDate >= monthStart && validityDate <= monthEnd;
    });
    const renewed = inMonth.filter(isCourseRenewed).length;
    return {
      label: monthStart.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      total: inMonth.length,
      renewed,
      pending: inMonth.length - renewed,
    };
  });
  const monthlyMax = Math.max(1, ...monthlyExpiry.map(bucket => bucket.total));

  // Expired or expiring within 1 month and not yet marked as renewed — the
  // same set the daily reminder email (funding_renewal_reminder cron) sends.
  const oneMonthAhead = startOfDay(addMonthsTo(today, 1));
  const pendingRenewalCourses = wsqCourses.filter(course => {
    const validityDate = parseValidityDate(course.fundingValidity);
    return !!validityDate && validityDate <= oneMonthAhead && !isCourseRenewed(course);
  });

  const expiryStatusLabel = (validityDate: Date) => {
    const days = Math.round((validityDate.getTime() - today.getTime()) / 86400000);
    if (days < 0) return { text: `Expired ${-days}d ago`, cls: 'text-red-600 dark:text-red-400' };
    if (days === 0) return { text: 'Expires today', cls: 'text-red-600 dark:text-red-400' };
    return { text: `${days}d left`, cls: 'text-amber-600 dark:text-amber-400' };
  };

  // Selection is always scoped to what is on screen: filter first, tick what you
  // see, apply. A row that scrolls out of the filter is never quietly included.
  const selectedVisible = visibleCourses.filter(course => selectedIds[course.id]);
  const allVisibleSelected = visibleCourses.length > 0 && selectedVisible.length === visibleCourses.length;

  const toggleAllVisible = () => {
    setSelectedIds(prev => {
      const next = { ...prev };
      if (allVisibleSelected) visibleCourses.forEach(course => { delete next[course.id]; });
      else visibleCourses.forEach(course => { next[course.id] = true; });
      return next;
    });
  };

  const toggleOne = (courseId: string) => {
    setSelectedIds(prev => {
      const next = { ...prev };
      if (next[courseId]) delete next[courseId];
      else next[courseId] = true;
      return next;
    });
  };

  const applyBulkStatus = async () => {
    const targets = selectedVisible;
    if (targets.length === 0) return;
    const nextStatus = bulkStatus.trim() ? bulkStatus : null;
    const label = renewStatusLabel(nextStatus);
    if (!window.confirm(`Set Renew Status to "${label}" for ${targets.length} course${targets.length === 1 ? '' : 's'}?`)) return;

    setBulkProgress({ done: 0, total: targets.length });
    const failed: string[] = [];
    // One at a time, so a failure part-way leaves the rest untouched and the
    // count on screen is always what has actually been written.
    for (let i = 0; i < targets.length; i++) {
      const course = targets[i];
      try {
        await apiClient.put('/api/admin/course-renewal-status', { courseId: course.id, status: nextStatus });
        setRenewStatusOverrides(prev => ({ ...prev, [course.id]: nextStatus }));
      } catch (err) {
        console.error('Bulk renewal status failed for', course.title, err);
        failed.push(course.title);
      }
      setBulkProgress({ done: i + 1, total: targets.length });
    }
    setBulkProgress(null);
    setSelectedIds({});
    if (failed.length > 0) {
      window.alert(`${failed.length} course${failed.length === 1 ? '' : 's'} could not be updated:\n\n${failed.slice(0, 10).join('\n')}`);
    }
    refetch();
  };

  const handleRenewStatusChange = async (courseId: string, value: string) => {
    const nextStatus = value.trim() ? value : null;
    setRenewStatusOverrides(prev => ({ ...prev, [courseId]: nextStatus }));
    setRenewingIds(prev => ({ ...prev, [courseId]: true }));

    try {
      await apiClient.put('/api/admin/course-renewal-status', {
        courseId,
        status: nextStatus,
      });
    } catch (err) {
      console.error('Failed to update renewal status:', err);
      setRenewStatusOverrides(prev => {
        const next = { ...prev };
        delete next[courseId];
        return next;
      });
      window.alert('Failed to update renewal status. Please try again.');
    } finally {
      setRenewingIds(prev => ({ ...prev, [courseId]: false }));
    }
  };

  const handleWhitelistToggle = async (courseId: string, checked: boolean) => {
    setWhitelistStateOverrides(prev => ({ ...prev, [courseId]: checked }));
    setWhitelistingIds(prev => ({ ...prev, [courseId]: true }));

    try {
      await apiClient.put('/api/admin/course-whitelist-status', {
        courseId,
        whitelist: checked,
      });
    } catch (err) {
      console.error('Failed to update whitelist status:', err);
      setWhitelistStateOverrides(prev => {
        const next = { ...prev };
        delete next[courseId];
        return next;
      });
      window.alert('Failed to update whitelist status. Please try again.');
    } finally {
      setWhitelistingIds(prev => ({ ...prev, [courseId]: false }));
    }
  };

  const startEdit = (course: any) => {
    setEditingId(course.id);
    setEditState({
      casScore: course.casScore != null ? String(course.casScore) : '',
      esScore: course.esScore != null ? String(course.esScore) : '',
      fundingValidity: toDateInputValue(course.fundingValidity),
      courseType: normalizeCourseType(course.courseType),
      newCourseCode: course.newCourseCode || '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const original = wsqCourses.find(c => c.id === editingId);
      const typeChanged = editState.courseType !== normalizeCourseType(original?.courseType);
      await apiClient.put('/api/admin/update-course-validity', {
        courseId: editingId,
        casScore: editState.casScore || null,
        esScore: editState.esScore || null,
        fundingValidity: editState.fundingValidity || null,
        newCourseCode: editState.newCourseCode.trim(),
        ...(typeChanged ? { courseType: editState.courseType } : {}),
      });
      setEditingId(null);
      refetch();
    } catch (err) {
      console.error('Failed to save:', err);
      window.alert('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Export the full list (not just what's on screen) so it can be filtered in Excel.
  const handleExport = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');

      const rows = wsqCourses.map(course => {
        const validityDate = parseValidityDate(course.fundingValidity);
        const renewDate = validityDate ? new Date(validityDate) : null;
        if (renewDate) renewDate.setMonth(renewDate.getMonth() - 3);

        return {
          'Course Title': course.title,
          'Course Ref Code (New)': course.newCourseCode || '',
          'Course Ref Code (Old)': course.courseCode || '',
          'Type': displayCourseType(course.courseType),
          'Validity Start Date': parseValidityDate(course.fundingValidityStart) || '',
          'Validity End Date': validityDate || '',
          'Renew Date': renewDate || '',
          'Status': !validityDate ? '' : validityDate < today ? 'Expired' : validityDate <= fourMonthsAhead ? 'Expiring Soon' : 'Valid',
          'CAS': course.casScore != null ? Number(course.casScore) : '',
          'ES': course.esScore != null ? Number(course.esScore) : '',
          'Whitelist': (whitelistStateOverrides[course.id] ?? !!course.whitelistStatus) ? 'Yes' : 'No',
          'Renew': isCourseRenewed(course) ? 'Yes' : 'No',
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true });

      // Header-row dropdowns in Excel — the Type column filters to WSQ / CASL.
      ws['!autofilter'] = { ref: ws['!ref'] };
      ws['!cols'] = [{ wch: 60 }, { wch: 20 }, { wch: 20 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 8 }];

      // Date columns (E, F) render as dd/mm/yyyy like the table.
      for (let r = 1; r <= rows.length; r++) {
        for (const col of ['E', 'F']) {
          const cell = ws[`${col}${r + 1}`];
          if (cell && cell.t === 'd') cell.z = 'dd/mm/yyyy';
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Funding Validity');
      XLSX.writeFile(wb, `funding-validity-${getLocalYMD(new Date())}.xlsx`);
    } catch (err) {
      console.error('Failed to export funding validity list:', err);
      window.alert('Failed to download the list. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  // Pre-filled template with only the columns the upload applies. The full
  // "Download Excel" export also uploads fine — the extra columns are ignored.
  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true);
    try {
      const XLSX = await import('xlsx');

      const rows = wsqCourses.map(course => ({
        'Course Title': course.title,
        'Course Ref Code (New)': course.newCourseCode || '',
        'Course Ref Code (Old)': course.courseCode || '',
        'Validity End Date': parseValidityDate(course.fundingValidity) || '',
        'CAS': course.casScore != null ? Number(course.casScore) : '',
        'ES': course.esScore != null ? Number(course.esScore) : '',
        'Whitelist': (whitelistStateOverrides[course.id] ?? !!course.whitelistStatus) ? 'Yes' : 'No',
        'Renew': isCourseRenewed(course) ? 'Yes' : 'No',
      }));

      const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true });
      ws['!autofilter'] = { ref: ws['!ref'] };
      ws['!cols'] = [{ wch: 60 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 8 }];
      for (let r = 1; r <= rows.length; r++) {
        const cell = ws[`D${r + 1}`];
        if (cell && cell.t === 'd') cell.z = 'dd/mm/yyyy';
      }

      const instructions = XLSX.utils.aoa_to_sheet([
        ['Funding Status Upload Template — Instructions'],
        [''],
        ['1.', 'Edit the "Funding Status" sheet, then upload this file back with the "Upload Excel" button.'],
        ['2.', 'Courses are matched by Course Ref Code (New), falling back to Course Ref Code (Old). Do not edit the ref code or title columns.'],
        ['3.', 'Editable columns: Validity End Date, CAS, ES, Whitelist, Renew.'],
        ['4.', 'Validity End Date: use a real Excel date (dd/mm/yyyy).'],
        ['5.', 'Whitelist / Renew: Yes or No.'],
        ['6.', 'A BLANK cell means "leave unchanged" — it never clears the stored value. To clear a value, use the Edit button on the dashboard.'],
        ['7.', 'Rows you delete from the sheet are simply not updated.'],
      ]);
      instructions['!cols'] = [{ wch: 4 }, { wch: 110 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Funding Status');
      XLSX.utils.book_append_sheet(wb, instructions, 'Instructions');
      XLSX.writeFile(wb, `funding-status-template-${getLocalYMD(new Date())}.xlsx`);
    } catch (err) {
      console.error('Failed to build funding status template:', err);
      window.alert('Failed to download the template. Please try again.');
    } finally {
      setDownloadingTemplate(false);
    }
  };

  // Accepts a cell that may be an Excel date, dd/mm/yyyy or yyyy-mm-dd text.
  const cellToYMD = (value: any): string | null => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return getLocalYMD(value);
    const s = String(value ?? '').trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return s; // let the server report it as invalid, naming the bad value
  };

  const cellToYesNo = (value: any): boolean | undefined => {
    const s = String(value ?? '').trim().toLowerCase();
    if (['yes', 'y', 'true', '1'].includes(s)) return true;
    if (['no', 'n', 'false', '0'].includes(s)) return false;
    return undefined;
  };

  const handleUploadFile = async (file: File) => {
    setUploading(true);
    setUploadSummary(null);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });

      const sheetName =
        workbook.SheetNames.find(name => name.toLowerCase() !== 'instructions') || workbook.SheetNames[0];
      const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

      const updates = rows
        .map(row => {
          const blank = (v: any) => String(v ?? '').trim() === '';
          const update: any = {
            newCode: String(row['Course Ref Code (New)'] ?? '').trim(),
            oldCode: String(row['Course Ref Code (Old)'] ?? '').trim(),
            title: String(row['Course Title'] ?? '').trim(),
          };
          if (!blank(row['Validity End Date'])) update.fundingValidity = cellToYMD(row['Validity End Date']);
          if (!blank(row['CAS'])) update.casScore = Number(row['CAS']);
          if (!blank(row['ES'])) update.esScore = Number(row['ES']);
          const whitelist = cellToYesNo(row['Whitelist']);
          if (whitelist !== undefined) update.whitelist = whitelist;
          const renew = cellToYesNo(row['Renew']);
          if (renew !== undefined) update.renew = renew;
          return update;
        })
        .filter(u => u.newCode || u.oldCode);

      if (updates.length === 0) {
        window.alert('No usable rows found. The file needs the template columns, including a Course Ref Code.');
        return;
      }

      const response = await apiClient.post('/api/admin/bulk-update-funding-status', { updates });
      const data = response?.data ?? response;
      setUploadSummary(data);
      refetch();
    } catch (err) {
      console.error('Failed to upload funding status file:', err);
      window.alert('Failed to process the uploaded file. Please check it matches the template and try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-on-surface-secondary">Loading funding validity...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 mb-4">Error loading WSQ courses: {error}</p>
      </div>
    );
  }

  // Sticky header cells: opaque background (a translucent one lets scrolled rows
  // show through) and the divider carried on the cell, since a border on a
  // sticky row does not travel with it.
  const stickyTh = "sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-3 py-2";

  const inputClass = "w-full px-1.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500";

  return (
    <div>
      <h3 className="text-3xl font-bold dark:text-white mb-6">Course Funding Validity</h3>

      <div className="grid grid-cols-4 gap-6 mb-6">
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-blue-600">{totalFunded}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Total Funded Courses</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">WSQ + CASL + IBF</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-emerald-600">{typeTotals.WSQ}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">WSQ Courses</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-teal-600">{typeTotals.CASL}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">CASL Courses</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-sky-600">{typeTotals.IBF}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">IBF Courses</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
        {expiryWindows.map(window => (
          <Card key={window.key} className="p-6 text-center">
            <p className={`text-4xl font-bold ${window.color}`}>{window.total}</p>
            <p className="text-gray-600 dark:text-gray-300 mt-1">{window.label}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {window.renewed} renewed · {window.total - window.renewed} pending
            </p>
          </Card>
        ))}
      </div>

      <Card className="mb-8 p-6 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Funding Expiry — Next 6 Months</h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">Courses whose funding validity ends each month, split by renewal status.</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-300">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#059669' }} />
              Renewed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#d97706' }} />
              Pending renewal
            </span>
          </div>
        </div>
        <div className="flex items-end gap-3 sm:gap-6 h-56">
          {monthlyExpiry.map(bucket => {
            const barHeight = (segment: number) => Math.round((segment / monthlyMax) * 176);
            const renewedPx = barHeight(bucket.renewed);
            const pendingPx = barHeight(bucket.pending);
            return (
              <div
                key={bucket.label}
                className="flex-1 flex flex-col items-center justify-end min-w-0"
                title={`${bucket.label}: ${bucket.total} expiring — ${bucket.renewed} renewed, ${bucket.pending} pending`}
              >
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1 tabular-nums">{bucket.total}</span>
                {bucket.total === 0 ? (
                  <div className="w-full max-w-[56px] h-px bg-gray-300 dark:bg-gray-600" />
                ) : (
                  <div className="w-full max-w-[56px] flex flex-col">
                    {bucket.pending > 0 && (
                      <div
                        className="w-full rounded-t"
                        style={{ height: `${Math.max(pendingPx, 3)}px`, backgroundColor: '#d97706', marginBottom: bucket.renewed > 0 ? 2 : 0 }}
                      >
                        {pendingPx >= 16 && <p className="text-[10px] font-semibold text-white text-center leading-4 tabular-nums">{bucket.pending}</p>}
                      </div>
                    )}
                    {bucket.renewed > 0 && (
                      <div
                        className={`w-full ${bucket.pending === 0 ? 'rounded-t' : ''}`}
                        style={{ height: `${Math.max(renewedPx, 3)}px`, backgroundColor: '#059669' }}
                      >
                        {renewedPx >= 16 && <p className="text-[10px] font-semibold text-white text-center leading-4 tabular-nums">{bucket.renewed}</p>}
                      </div>
                    )}
                  </div>
                )}
                <span className="mt-2 text-[11px] text-gray-600 dark:text-gray-400 whitespace-nowrap">{bucket.label}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mb-8 dark:bg-gray-800 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
            Expiring Within 1 Month — Not Yet Renewed
            <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
              {pendingRenewalCourses.length}
            </span>
          </h4>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Courses whose funding validity has expired or ends within 1 month and are not marked as renewed. This list is emailed daily by the Funding Renewal Reminder task.
          </p>
        </div>
        {pendingRenewalCourses.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
            No courses pending renewal within the next month. 🎉
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-900/40">
                <tr className="text-left text-gray-600 dark:text-gray-300">
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Course Title</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Course Ref Code</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Type</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Validity End Date</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingRenewalCourses.map(course => {
                  const validityDate = parseValidityDate(course.fundingValidity)!;
                  const status = expiryStatusLabel(validityDate);
                  return (
                    <tr key={course.id} className="border-t border-gray-200 dark:border-gray-700">
                      <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-white max-w-[350px] truncate" title={course.title}>{course.title}</td>
                      <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{course.newCourseCode || course.courseCode || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{displayCourseType(course.courseType)}</td>
                      <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatValidityDate(course.fundingValidity)}</td>
                      <td className={`px-3 py-1.5 font-semibold whitespace-nowrap ${status.cls}`}>{status.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mb-4">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by course title, ref code or type…"
            className="w-full pl-4 pr-10 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-lg leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              ×
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as 'All' | 'WSQ' | 'CASL' | 'IBF' | 'Non-WSQ')}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="All">All Types</option>
              <option value="WSQ">WSQ</option>
              <option value="CASL">CASL</option>
              <option value="IBF">IBF</option>
              <option value="Non-WSQ">Non-WSQ</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">End Date From</label>
            <input
              type="date"
              value={endDateFrom}
              onChange={e => setEndDateFrom(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">End Date To</label>
            <input
              type="date"
              value={endDateTo}
              onChange={e => setEndDateTo(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          {filtersActive && (
            <button
              onClick={() => { setSearch(''); setTypeFilter('All'); setEndDateFrom(''); setEndDateTo(''); }}
              className="px-3 py-2 text-sm font-medium rounded-lg text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Reset Filters
            </button>
          )}
        </div>
        {filtersActive && (
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            Showing {visibleCourses.length} of {wsqCourses.length} courses. The Excel download still contains the full list.
          </p>
        )}
      </div>

      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Course Validity List</h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">Sorted from earliest validity date to latest. Courses expiring within 4 months are highlighted.</p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={exporting || wsqCourses.length === 0}
              className="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {exporting ? 'Preparing…' : 'Download Excel'}
            </button>
            <button
              onClick={handleDownloadTemplate}
              disabled={downloadingTemplate || wsqCourses.length === 0}
              className="px-3 py-1.5 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              title="Pre-filled template — edit the validity dates, CAS/ES, Whitelist and Renew columns, then upload it back"
            >
              {downloadingTemplate ? 'Preparing…' : 'Download Template'}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              title="Upload the edited template (or the full Excel export) to update funding status in bulk"
            >
              {uploading ? 'Uploading…' : 'Upload Excel'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleUploadFile(file);
              }}
            />
          </div>
        </div>

        {uploadSummary && (
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
            <div className="flex items-start justify-between gap-4">
              <div className="text-sm">
                <p className="font-semibold text-gray-900 dark:text-white">
                  Upload complete — {uploadSummary.updated} updated
                  {uploadSummary.unchanged > 0 && <>, {uploadSummary.unchanged} unchanged</>}
                  {uploadSummary.failed > 0 && <span className="text-red-600 dark:text-red-400">, {uploadSummary.failed} failed</span>}
                </p>
                {uploadSummary.failed > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-red-600 dark:text-red-400 list-disc list-inside">
                    {uploadSummary.results
                      .filter(r => r.action === 'failed')
                      .slice(0, 20)
                      .map((r, i) => (
                        <li key={i}>
                          <span className="font-medium">{r.refCode}</span>
                          {r.title ? ` (${r.title})` : ''}: {r.message}
                        </li>
                      ))}
                    {uploadSummary.results.filter(r => r.action === 'failed').length > 20 && (
                      <li>…and {uploadSummary.results.filter(r => r.action === 'failed').length - 20} more.</li>
                    )}
                  </ul>
                )}
              </div>
              <button
                onClick={() => setUploadSummary(null)}
                aria-label="Dismiss upload summary"
                className="text-lg leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {selectedVisible.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {selectedVisible.length} selected
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-300">Set Renew Status to</span>
            <select
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value)}
              disabled={!!bulkProgress}
              className="px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
            >
              {RENEW_STATUS_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              onClick={applyBulkStatus}
              disabled={!!bulkProgress}
              className="px-3 py-1.5 text-sm font-semibold rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {bulkProgress ? `Applying ${bulkProgress.done} of ${bulkProgress.total}…` : 'Apply'}
            </button>
            <button
              onClick={() => setSelectedIds({})}
              disabled={!!bulkProgress}
              className="px-3 py-1.5 text-sm font-medium rounded text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Fixed-height scroller so only the rows move; the header sticks to the
            top of it (sticky lives on each th — a sticky thead is unreliable). */}
        <div className="overflow-auto max-h-[70vh]">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-gray-600 dark:text-gray-300">
                <th className={`${stickyTh} w-8`}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    disabled={visibleCourses.length === 0}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                    aria-label="Select all courses shown"
                  />
                </th>
                <th className={`${stickyTh} font-semibold whitespace-nowrap`}>Course Title</th>
                <th className={`${stickyTh} font-semibold whitespace-nowrap`}>Course Ref Code (New)</th>
                <th className={`${stickyTh} font-semibold whitespace-nowrap`}>Course Ref Code (Old)</th>
                <th className={`${stickyTh} font-semibold whitespace-nowrap`}>Type</th>
                <th className={`${stickyTh} font-semibold whitespace-nowrap`}>Validity Start Date</th>
                <th className={`${stickyTh} font-semibold whitespace-nowrap`}>Validity End Date</th>
                <th className={`${stickyTh} font-semibold whitespace-nowrap`}>Renew Date</th>
                <th
                  className={`${stickyTh} font-semibold whitespace-nowrap`}
                  title="Where this course's renewal stands. Set it to Renewed — Processing once the renewal is with SSG: the course then reads as Renewal Pending instead of Expiring Soon / Expired, until the new validity end date comes through."
                >
                  Renew Status
                </th>
                <th className={`${stickyTh} font-semibold text-right whitespace-nowrap`}>CAS</th>
                <th className={`${stickyTh} font-semibold text-right whitespace-nowrap`}>ES</th>
                <th className={`${stickyTh} font-semibold text-center whitespace-nowrap`}>Whitelist</th>
                <th className={`${stickyTh} font-semibold text-center w-20`}></th>
              </tr>
            </thead>
            <tbody>
              {visibleCourses.map(course => {
                const validityDate = parseValidityDate(course.fundingValidity);
                const expiringSoon = !!validityDate && validityDate >= today && validityDate <= fourMonthsAhead;
                const expired = !!validityDate && validityDate < today;
                const renewStatus = effectiveRenewStatus(course);
                const renewClass = classifyRenewStatus(renewStatus);
                // A value the dropdown doesn't offer ('To Renew', 'Processing') is
                // shown as a disabled option so the row still reports what it holds
                // and rendering never rewrites it — the selectable options stay
                // identical on every row.
                const legacyRenewStatus = renewStatus && !isKnownRenewStatus(renewStatus) ? renewStatus : null;
                // Only a renewal still with SSG calms the row down — see validityPill.
                const awaitingSsg = renewClass === 'Waiting';
                const isEditing = editingId === course.id;

                return (
                  <tr
                    key={course.id}
                    className={`border-t border-gray-200 dark:border-gray-700 ${
                      awaitingSsg
                        ? (expired || expiringSoon ? 'bg-blue-50/70 dark:bg-blue-900/10' : '')
                        : expired
                          ? 'bg-red-50/70 dark:bg-red-900/10'
                          : expiringSoon
                            ? 'bg-amber-50/80 dark:bg-amber-900/10'
                            : ''
                    }`}
                  >
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={!!selectedIds[course.id]}
                        onChange={() => toggleOne(course.id)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        aria-label={`Select ${course.title}`}
                      />
                    </td>
                    <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-white max-w-[350px] truncate" title={course.title}>{course.title}</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editState.newCourseCode}
                          onChange={e => setEditState(s => ({ ...s, newCourseCode: e.target.value }))}
                          placeholder="New ref code"
                          className={`${inputClass} w-36`}
                        />
                      ) : (
                        course.newCourseCode || '—'
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{course.courseCode || '—'}</td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">
                      {isEditing ? (
                        <select
                          value={editState.courseType}
                          onChange={e => setEditState(s => ({ ...s, courseType: e.target.value as 'WSQ' | 'CASL' | 'Non-WSQ' }))}
                          className={`${inputClass} w-24`}
                        >
                          <option value="WSQ">WSQ</option>
                          <option value="Non-WSQ">Non-WSQ</option>
                        </select>
                      ) : (
                        displayCourseType(course.courseType)
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {course.fundingValidityStart ? formatValidityDate(course.fundingValidityStart) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editState.fundingValidity}
                          onChange={e => setEditState(s => ({ ...s, fundingValidity: e.target.value }))}
                          className={`${inputClass} w-32`}
                        />
                      ) : (
                        <>
                          <span>{formatValidityDate(course.fundingValidity)}</span>
                          {(expired || expiringSoon) && (course.courseType === 'WSQ' || course.courseType === 'CASL') && (() => {
                            const pill = validityPill(renewClass, expired);
                            const stored = (renewStatus || '').trim();
                            return (
                              <span
                                className={`ml-2 text-[10px] font-semibold uppercase ${pill.cls}`}
                                title={[stored && `Renew status: ${stored}`, pill.title].filter(Boolean).join(' — ') || undefined}
                              >
                                {pill.text}
                              </span>
                            );
                          })()}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {validityDate ? (() => {
                        const renewDate = new Date(validityDate);
                        renewDate.setMonth(renewDate.getMonth() - 3);
                        const isPast = renewDate < new Date();
                        return <span className={isPast ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-700 dark:text-gray-300'}>{renewDate.toLocaleDateString('en-GB')}</span>;
                      })() : '—'}
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        value={renewStatus || ''}
                        disabled={!!renewingIds[course.id]}
                        onChange={(e) => handleRenewStatusChange(course.id, e.target.value)}
                        className={`${inputClass} w-40`}
                        aria-label={`Renewal status for ${course.title}`}
                      >
                        {legacyRenewStatus && <option value={legacyRenewStatus} disabled>{legacyRenewStatus}</option>}
                        {RENEW_STATUS_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-300">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editState.casScore}
                          onChange={e => setEditState(s => ({ ...s, casScore: e.target.value }))}
                          className={`${inputClass} w-16 text-right`}
                        />
                      ) : (
                        course.casScore != null ? course.casScore.toFixed(2) : '—'
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-300">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editState.esScore}
                          onChange={e => setEditState(s => ({ ...s, esScore: e.target.value }))}
                          className={`${inputClass} w-16 text-right`}
                        />
                      ) : (
                        course.esScore != null ? course.esScore.toFixed(2) : '—'
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={whitelistStateOverrides[course.id] ?? !!course.whitelistStatus}
                        disabled={!!whitelistingIds[course.id]}
                        onChange={(e) => handleWhitelistToggle(course.id, e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                        aria-label={`Whitelist ${course.title}`}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={saveEdit}
                            disabled={saving}
                            className="px-2 py-0.5 text-[10px] font-medium rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {saving ? '...' : 'Save'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={saving}
                            className="px-2 py-0.5 text-[10px] font-medium rounded bg-gray-500 text-white hover:bg-gray-600 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(course)}
                          className="px-2 py-0.5 text-[10px] font-medium rounded bg-blue-600 text-white hover:bg-blue-700"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visibleCourses.length === 0 && (
          <div className="px-6 py-10 text-center text-gray-500 dark:text-gray-400">
            {search.trim() ? `No courses match “${search.trim()}”.` : 'No courses found.'}
          </div>
        )}
      </Card>
    </div>
  );
};

export default FundingValidityView;
