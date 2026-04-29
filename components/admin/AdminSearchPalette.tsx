import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLms } from '@contexts/LmsContext';
import { View, AdminPage } from '@app-types';
import { Icon, IconName } from '../ui/Icon';

type SearchItem = {
  label: string;
  section: string;
  page: AdminPage;
  keywords?: string[];
};

const SEARCH_ITEMS: SearchItem[] = [
  { label: 'Admin Dashboard', section: 'Admin', page: AdminPage.Dashboard },
  { label: 'Master List', section: 'Class Management', page: AdminPage.MasterList },

  { label: 'Ongoing Classes', section: 'Class Management → Classes', page: AdminPage.OngoingClasses },
  { label: 'Upcoming Classes', section: 'Class Management → Classes', page: AdminPage.UpcomingClasses },
  { label: 'Completed Classes', section: 'Class Management → Classes', page: AdminPage.CompletedClasses },

  { label: 'Assign Trainer', section: 'Class Management → Trainers', page: AdminPage.AssignTrainer },
  { label: 'View Learners', section: 'Class Management → Learners', page: AdminPage.ViewLearners },
  { label: 'Assign Learners', section: 'Class Management → Learners', page: AdminPage.AssignStudent, keywords: ['students', 'enroll'] },
  { label: 'Search Past Learners', section: 'Class Management → Learners', page: AdminPage.SearchPastLearners },

  { label: 'View Courses', section: 'Class Management', page: AdminPage.ViewCourses },
  { label: 'View Trainers', section: 'Class Management', page: AdminPage.ViewTrainers },
  { label: 'Funding Validity', section: 'Class Management', page: AdminPage.FundingValidity },

  { label: 'Upload Direct Application', section: 'TPG Management → Direct Application', page: AdminPage.UploadDirectApplication },
  { label: 'View Direct Application', section: 'TPG Management → Direct Application', page: AdminPage.ViewDirectApplication },
  { label: 'Update Direct Application', section: 'TPG Management → Direct Application', page: AdminPage.UpdateDirectApplication },

  { label: 'Upcoming Enrolment', section: 'TPG Management → Enrolment', page: AdminPage.UpcomingEnrolment },
  { label: 'New Enrolment', section: 'TPG Management → Enrolment', page: AdminPage.NewEnrolment },

  { label: 'View Class By Date', section: 'TPG Management → Course Run', page: AdminPage.ViewClassByDate },
  { label: 'Create New Class', section: 'TPG Management → Course Run', page: AdminPage.CreateNewClass },
  { label: 'Search Course Runs', section: 'TPG Management → Course Run', page: AdminPage.SearchCourseRuns },
  { label: 'View Course Run', section: 'TPG Management → Course Run', page: AdminPage.ViewCourseRun },
  { label: 'Edit Course Run', section: 'TPG Management → Course Run', page: AdminPage.EditCourseRun },
  { label: 'Upload Course Runs', section: 'TPG Management → Course Run', page: AdminPage.UploadCourseRuns },
  { label: 'Delete Course Run', section: 'TPG Management → Course Run', page: AdminPage.DeleteCourseRun },

  { label: 'Add Sessions', section: 'TPG Management → Session', page: AdminPage.AddSessions },
  { label: 'Course Sessions', section: 'TPG Management → Session', page: AdminPage.CourseSessions },

  { label: 'Enroll Learners', section: 'TPG Management → Enrolment', page: AdminPage.EnrollLearners },
  { label: 'Upload Enrolments', section: 'TPG Management → Enrolment', page: AdminPage.UploadEnrolments },
  { label: 'Search Enrolment', section: 'TPG Management → Enrolment', page: AdminPage.SearchEnrolment },
  { label: 'View Enrolment', section: 'TPG Management → Enrolment', page: AdminPage.ViewEnrolment },
  { label: 'Update Enrolment', section: 'TPG Management → Enrolment', page: AdminPage.UpdateEnrolment },
  { label: 'Cancel Enrolment', section: 'TPG Management → Enrolment', page: AdminPage.CancelEnrolment, keywords: ['unenrol', 'unenroll', 'remove', 'withdraw'] },
  { label: 'Update Enrolment Fees', section: 'TPG Management → Enrolment', page: AdminPage.UpdateEnrolmentFees },

  { label: 'Session Attendance', section: 'TPG Management → Attendance', page: AdminPage.CourseSessionAttendance },
  { label: 'Check Attendance', section: 'TPG Management → Attendance', page: AdminPage.CheckAttendance },

  { label: 'Submit Assessment', section: 'TPG Management → Assessment', page: AdminPage.SubmitAssessment },
  { label: 'Update Assessment', section: 'TPG Management → Assessment', page: AdminPage.UpdateAssessment },
  { label: 'Bulk Update Assessment', section: 'TPG Management → Assessment', page: AdminPage.BulkUpdateAssessment },
  { label: 'Search Assessments', section: 'TPG Management → Assessment', page: AdminPage.SearchAssessments },
  { label: 'View Assessment', section: 'TPG Management → Assessment', page: AdminPage.ViewAssessment },

  { label: 'Grant Calculator', section: 'TPG Management → Grant', page: AdminPage.GrantCalculator },
  { label: 'Search Grant', section: 'TPG Management → Grant', page: AdminPage.SearchGrant },
  { label: 'View Grant Status', section: 'TPG Management → Grant', page: AdminPage.ViewGrantStatus },

  { label: 'View Calendar', section: 'Tools', page: AdminPage.Calendar },
  { label: 'Task Scheduler', section: 'Tools', page: AdminPage.Scheduler },
  { label: 'Schedule Summary', section: 'Tools', page: AdminPage.SchedulerSummary },

  { label: 'Create Certificate', section: 'Certificates', page: AdminPage.CreateCertificate },
  { label: 'Delete Certificate', section: 'Certificates', page: AdminPage.DeleteCertificate },
  { label: 'Send Certificate (SG)', section: 'Certificates', page: AdminPage.SendCertificateSG },
  { label: 'Send Certificate (GH)', section: 'Certificates', page: AdminPage.SendCertificateGH },

  { label: 'View All Tickets', section: 'Support', page: AdminPage.SupportTickets },
];

const scoreItem = (item: SearchItem, query: string): number => {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const labelLc = item.label.toLowerCase();
  const haystack = [item.label, item.section, ...(item.keywords ?? [])].join(' ').toLowerCase();
  if (labelLc === q) return 1000;
  if (labelLc.startsWith(q)) return 500 - item.label.length;
  if (labelLc.includes(q)) return 300 - item.label.length;
  if (haystack.includes(q)) return 100;
  const words = q.split(/\s+/).filter(Boolean);
  return words.every(w => haystack.includes(w)) ? 50 : 0;
};

interface AdminSearchPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const AdminSearchPalette: React.FC<AdminSearchPaletteProps> = ({ isOpen, onClose }) => {
  const { handleNavigation, setAdminPage } = useLms();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return SEARCH_ITEMS.slice(0, 12);
    return SEARCH_ITEMS
      .map(item => ({ item, score: scoreItem(item, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map(({ item }) => item);
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, results.length]);

  if (!isOpen) return null;

  const goTo = (item: SearchItem) => {
    handleNavigation(View.Admin);
    setAdminPage(item.page);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[activeIndex]) goTo(results[activeIndex]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-20 sm:pt-24 px-4 bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search functions"
    >
      <div
        className="w-full max-w-xl bg-surface rounded-xl shadow-2xl border border-default overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 border-b border-default">
          <Icon name={IconName.Search} className="w-5 h-5 text-on-surface-secondary mr-3 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search functions, e.g. cancel enrolment"
            className="flex-1 bg-transparent text-on-surface placeholder:text-on-surface-secondary outline-none text-base"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-on-surface-secondary border border-default rounded ml-2">ESC</kbd>
        </div>
        <ul ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-sm text-center text-on-surface-secondary">No matches</li>
          ) : results.map((item, idx) => (
            <li key={item.page}>
              <button
                data-idx={idx}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => goTo(item)}
                className={`w-full flex items-center justify-between gap-3 text-left px-4 py-2.5 text-sm transition-colors ${
                  idx === activeIndex
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface hover:bg-surface-elevated'
                }`}
              >
                <span className="font-medium truncate">{item.label}</span>
                <span className="text-xs text-on-surface-secondary truncate">{item.section}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-on-surface-secondary border-t border-default bg-surface-elevated">
          <span>↑↓ navigate · ↵ open</span>
          <span>{results.length} result{results.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
};

export default AdminSearchPalette;
