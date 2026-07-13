import React, { useMemo, useState } from 'react';
import { useDeveloperCourses } from '@hooks/useDeveloperCourses';
import { Card } from '../ui/Card';
import { getLocalYMD } from '@/lib/dateHelpers';
import { apiClient } from '@lib/services/apiClient';

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

const displayCourseType = (value?: string | null) => {
  if (value === 'Non-WSQ') return 'CASL';
  return value || 'CASL';
};

// Collapse the stored course_type into the two editable buckets. Anything that
// isn't exactly 'WSQ' (incl. IBF / non-WSQ) is treated as Non-WSQ here.
const normalizeCourseType = (value?: string | null): 'WSQ' | 'Non-WSQ' =>
  value === 'WSQ' ? 'WSQ' : 'Non-WSQ';

interface EditState {
  casScore: string;
  esScore: string;
  fundingValidity: string;
  courseType: 'WSQ' | 'Non-WSQ';
  newCourseCode: string;
}

const FundingValidityView: React.FC = () => {
  const { courses, loading, error, refetch } = useDeveloperCourses();
  const [renewingIds, setRenewingIds] = useState<Record<string, boolean>>({});
  const [renewStateOverrides, setRenewStateOverrides] = useState<Record<string, boolean>>({});
  const [whitelistingIds, setWhitelistingIds] = useState<Record<string, boolean>>({});
  const [whitelistStateOverrides, setWhitelistStateOverrides] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ casScore: '', esScore: '', fundingValidity: '', courseType: 'WSQ', newCourseCode: '' });
  const [saving, setSaving] = useState(false);

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

  const isRenewDateAfterToday = (course: any) => {
    const validityDate = parseValidityDate(course.fundingValidity);
    if (!validityDate) return false;
    const renewDate = new Date(validityDate);
    renewDate.setMonth(renewDate.getMonth() - 3);
    return renewDate >= today;
  };

  const toBeRenewed = wsqCourses.filter(isRenewDateAfterToday).length;

  const yetToReview = wsqCourses.filter(course => {
    const checked = renewStateOverrides[course.id] ?? isRenewed(course.renewedStatus);
    return isRenewDateAfterToday(course) && !checked;
  }).length;

  const handleRenewToggle = async (courseId: string, checked: boolean) => {
    setRenewStateOverrides(prev => ({ ...prev, [courseId]: checked }));
    setRenewingIds(prev => ({ ...prev, [courseId]: true }));

    try {
      await apiClient.put('/api/admin/course-renewal-status', {
        courseId,
        renew: checked,
      });
    } catch (err) {
      console.error('Failed to update renewal status:', err);
      setRenewStateOverrides(prev => {
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

  const inputClass = "w-full px-1.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500";

  return (
    <div>
      <h3 className="text-3xl font-bold dark:text-white mb-6">Funding Validity</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-blue-600">{wsqCourses.length}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Courses</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-amber-500">{toBeRenewed}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Courses To Be Renewed</p>
        </Card>
        <Card className="p-6 text-center">
          <p className="text-4xl font-bold text-purple-600">{yetToReview}</p>
          <p className="text-gray-600 dark:text-gray-300 mt-1">Yet To Renew</p>
        </Card>
      </div>

      <Card className="dark:bg-gray-800 dark:border-gray-700">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-4">
          <div>
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Course Validity List</h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">Sorted from earliest validity date to latest. Courses expiring within 4 months are highlighted.</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-900/40">
              <tr className="text-left text-gray-600 dark:text-gray-300">
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Course Title</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Course Ref Code (New)</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Course Ref Code (Old)</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Type</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Validity End Date</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Renew Date</th>
                <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">CAS</th>
                <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">ES</th>
                <th className="px-3 py-2 font-semibold text-center whitespace-nowrap">Whitelist</th>
                <th className="px-3 py-2 font-semibold text-center whitespace-nowrap">Renew</th>
                <th className="px-3 py-2 font-semibold text-center w-20"></th>
              </tr>
            </thead>
            <tbody>
              {wsqCourses.map(course => {
                const validityDate = parseValidityDate(course.fundingValidity);
                const expiringSoon = !!validityDate && validityDate >= today && validityDate <= fourMonthsAhead;
                const expired = !!validityDate && validityDate < today;
                const checked = renewStateOverrides[course.id] ?? isRenewed(course.renewedStatus);
                const isEditing = editingId === course.id;

                return (
                  <tr
                    key={course.id}
                    className={`border-t border-gray-200 dark:border-gray-700 ${
                      expired
                        ? 'bg-red-50/70 dark:bg-red-900/10'
                        : expiringSoon
                          ? 'bg-amber-50/80 dark:bg-amber-900/10'
                          : ''
                    }`}
                  >
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
                          onChange={e => setEditState(s => ({ ...s, courseType: e.target.value as 'WSQ' | 'Non-WSQ' }))}
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
                          {expired && course.courseType === 'WSQ' && <span className="ml-2 text-[10px] font-semibold uppercase text-red-600 dark:text-red-400">Expired</span>}
                          {!expired && expiringSoon && course.courseType === 'WSQ' && <span className="ml-2 text-[10px] font-semibold uppercase text-amber-600 dark:text-amber-400">Expiring Soon</span>}
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
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!!renewingIds[course.id]}
                        onChange={(e) => handleRenewToggle(course.id, e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                        aria-label={`Mark ${course.title} for renewal`}
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

        {wsqCourses.length === 0 && (
          <div className="px-6 py-10 text-center text-gray-500 dark:text-gray-400">
            No courses found.
          </div>
        )}
      </Card>
    </div>
  );
};

export default FundingValidityView;
