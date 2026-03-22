import React, { useState, useMemo } from 'react';
import { useLms } from '@contexts/LmsContext';
import { useTrainerCourses } from '@hooks/useTrainerCourses';
import { Course } from '@app-types';
import { Badge } from '@components/ui/Badge';
import { Icon, IconName } from '@components/ui/Icon';
import Spinner from '@components/ui/Spinner';
import { EmptyState } from '@components/ui/EmptyState';
import { getCourseImageUrl } from '@utils/imageUtils';

// ── Shared helpers ──

const getTypeStyle = (courseType: string) => {
  switch (courseType) {
    case 'WSQ': return 'bg-blue-500/20 text-blue-300 border border-blue-400/30';
    case 'IBF': return 'bg-purple-500/20 text-purple-300 border border-purple-400/30';
    default: return 'bg-gray-500/20 text-gray-300 border border-gray-400/30';
  }
};

const getModeStyle = (mode: string) => {
  switch (mode) {
    case 'Virtual': return 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/30';
    case 'Hybrid': return 'bg-amber-500/20 text-amber-300 border border-amber-400/30';
    default: return 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30';
  }
};

const getStatusColor = (status: string | undefined) => {
  switch (status?.toLowerCase()) {
    case 'confirmed': return 'bg-emerald-500';
    case 'pending': return 'bg-amber-500';
    case 'cancelled': return 'bg-red-500';
    default: return 'bg-gray-500';
  }
};

const formatDate = (dateString: string | undefined): string => {
  if (!dateString) return 'TBD';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'TBD';
  return date.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ── Quick Actions (exported for reuse) ──

export const QUICK_ACTIONS = [
  {
    title: 'Break Timer',
    description: 'Musical countdown for breaks',
    href: 'https://alfredang.github.io/musical-timer-countdown/',
    icon: IconName.Clock,
    accent: 'from-blue-600 to-cyan-500',
    bg: 'from-blue-500/10 to-cyan-500/10 hover:from-blue-500/20 hover:to-cyan-500/20',
    ring: 'group-hover/qa:ring-blue-400/30',
  },
  {
    title: 'Pinboard',
    description: 'Collaborative class pinboard',
    href: 'https://alfredang.github.io/pinboard/',
    icon: IconName.Bookmark,
    accent: 'from-purple-600 to-pink-500',
    bg: 'from-purple-500/10 to-pink-500/10 hover:from-purple-500/20 hover:to-pink-500/20',
    ring: 'group-hover/qa:ring-purple-400/30',
  },
];

export const QuickActionsBar: React.FC = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
    {QUICK_ACTIONS.map((action) => (
      <a
        key={action.title}
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`group/qa relative flex items-center gap-4 p-5 rounded-2xl bg-gradient-to-r ${action.bg} border border-white/[0.06] backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-black/10 ring-1 ring-transparent ${action.ring}`}
      >
        <div className={`flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br ${action.accent} flex items-center justify-center shadow-lg`}>
          <Icon name={action.icon} className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-on-surface">{action.title}</p>
          <p className="text-xs text-on-surface-secondary mt-0.5">{action.description}</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center opacity-0 group-hover/qa:opacity-100 transition-all duration-300 group-hover/qa:translate-x-0 -translate-x-2">
          <Icon name={IconName.ExternalLink} className="w-4 h-4 text-on-surface-secondary" />
        </div>
      </a>
    ))}
  </div>
);

// ── Class Card (exported for reuse) ──

interface ClassCardProps {
  course: Course;
  onSelect: (course: Course) => void;
}

export const ClassCard: React.FC<ClassCardProps> = ({ course, onSelect }) => {
  const totalHours = Number(course.trainingHours || 0) + Number(course.assessmentHours || 0);

  return (
    <div
      onClick={() => onSelect(course)}
      className="group relative flex flex-col rounded-2xl overflow-hidden cursor-pointer bg-surface border border-white/[0.06] transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-primary/10 hover:border-primary/30"
    >
      {/* Image with gradient overlay */}
      <div className="relative h-40 overflow-hidden">
        <img
          src={getCourseImageUrl(course.imageUrl, course.id)}
          alt={course.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          onError={(e) => {
            (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${course.id || 'default'}/400/200`;
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 via-gray-900/40 to-transparent" />

        {/* Status dot + label */}
        {course.classStatus && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10">
            <div className={`w-1.5 h-1.5 rounded-full ${getStatusColor(course.classStatus)} animate-pulse`} />
            <span className="text-[10px] font-semibold text-white/90 uppercase tracking-wider">{course.classStatus}</span>
          </div>
        )}

        {/* Title overlay on image */}
        <div className="absolute bottom-3 left-4 right-4">
          <h3 className="font-bold text-white text-sm leading-tight line-clamp-2 drop-shadow-lg">
            {course.title}
          </h3>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-grow">
        {/* Date */}
        <div className="flex items-center gap-2 text-xs text-on-surface-secondary mb-3">
          <Icon name={IconName.Calendar} className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span>{formatDate(course.startDate)} &mdash; {formatDate(course.endDate)}</span>
        </div>

        {/* Details — compact grid */}
        <div className="space-y-1.5 text-xs flex-grow">
          <div className="flex justify-between">
            <span className="text-on-surface-secondary">TGS Ref</span>
            <span className="font-mono text-on-surface font-medium">{course.courseCode || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-on-surface-secondary">Duration</span>
            <span className="text-on-surface">{totalHours}h <span className="text-on-surface-secondary">({course.trainingHours}T + {course.assessmentHours}A)</span></span>
          </div>
          <div className="flex justify-between">
            <span className="text-on-surface-secondary">Run ID</span>
            <span className="font-mono text-on-surface font-medium">{course.courseRunCode || '—'}</span>
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {course.courseType && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${getTypeStyle(course.courseType)}`}>
              {course.courseType}
            </span>
          )}
          {course.modeOfLearning?.map((mode) => (
            <span key={mode} className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wider ${getModeStyle(mode)}`}>
              {mode}
            </span>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.06] mt-4 pt-3 flex justify-between items-center">
          <span className="text-xs font-semibold text-on-surface-secondary group-hover:text-primary transition-colors">View Class</span>
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-all duration-300">
            <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main TrainerMyClasses Page ──

const TrainerMyClasses: React.FC = () => {
  const { currentUser, loadCourseData } = useLms();
  const { courses, loading, error, refetchCourses } = useTrainerCourses(currentUser?.id);
  const [classView, setClassView] = useState<'upcoming' | 'past'>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const today = new Date(new Date().toISOString().split('T')[0]);

  const filteredCourses = useMemo(() => {
    let filtered = courses.filter((c) => {
      const end = c.endDate ? new Date(c.endDate) : null;
      if (classView === 'past') {
        return end !== null && end < today;
      }
      return !end || end >= today;
    });

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.title?.toLowerCase().includes(q) ||
          c.courseCode?.toLowerCase().includes(q) ||
          c.courseRunCode?.toLowerCase().includes(q)
      );
    }

    return filtered.sort((a, b) => {
      const aTime = new Date(a.startDate ?? '').getTime();
      const bTime = new Date(b.startDate ?? '').getTime();
      return classView === 'past' ? bTime - aTime : aTime - bTime;
    });
  }, [courses, classView, searchQuery]);

  const handleSelectCourse = async (course: Course) => {
    setLoadError(null);
    try {
      await loadCourseData(course);
    } catch (err) {
      console.error('Error loading course data:', err);
      setLoadError('Failed to load class details. Please try again.');
    }
  };

  return (
    <div className="space-y-8">

      {/* ── Page Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-on-surface">My Classes</h1>
        <p className="text-sm text-on-surface-secondary mt-1">
          View your assigned classes, manage assessments and access teaching tools.
        </p>
      </div>

      {/* ── Search & Filter Bar ── */}
      <div className="bg-surface rounded-xl border border-white/[0.06] p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">General Search</h3>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 p-1 bg-white/[0.04] rounded-lg border border-white/[0.06]">
              <button
                onClick={() => setClassView('upcoming')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
                  classView === 'upcoming'
                    ? 'bg-primary text-white shadow-lg shadow-primary/25'
                    : 'text-on-surface-secondary hover:text-on-surface hover:bg-white/[0.04]'
                }`}
              >
                Upcoming
              </button>
              <button
                onClick={() => setClassView('past')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
                  classView === 'past'
                    ? 'bg-primary text-white shadow-lg shadow-primary/25'
                    : 'text-on-surface-secondary hover:text-on-surface hover:bg-white/[0.04]'
                }`}
              >
                Past Classes
              </button>
            </div>
            <span className="text-xs text-muted hidden sm:block">
              {filteredCourses.length} {filteredCourses.length === 1 ? 'class' : 'classes'}
            </span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-xs font-semibold text-primary hover:text-primary-hover transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        </div>
        <div className="relative">
          <Icon name={IconName.Search} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search title, code, TSC..."
            className="w-full sm:max-w-md pl-9 pr-3 py-2.5 text-sm bg-white/[0.04] border border-white/[0.06] rounded-lg text-on-surface placeholder-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
          />
        </div>
      </div>

      {/* ── Load Error ── */}
      {loadError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          <Icon name={IconName.InfoCircle} className="w-4 h-4 flex-shrink-0" />
          {loadError}
        </div>
      )}

      {/* ── Content ── */}
      {loading ? (
        <div className="py-16">
          <Spinner size="lg" text="Loading your classes..." />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-sm text-red-400 mb-3">{error}</p>
          <button
            onClick={refetchCourses}
            className="px-4 py-2 text-sm font-medium text-primary hover:text-primary-hover transition-colors"
          >
            Try again
          </button>
        </div>
      ) : filteredCourses.length === 0 ? (
        <EmptyState
          icon={IconName.BookOpen}
          title={classView === 'upcoming' ? 'No upcoming classes' : 'No past classes'}
          description={
            classView === 'upcoming'
              ? 'You don\'t have any upcoming classes assigned yet.'
              : 'No completed classes found.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredCourses.map((course) => (
            <ClassCard key={course.courseRunId || course.id} course={course} onSelect={handleSelectCourse} />
          ))}
        </div>
      )}

    </div>
  );
};

export default TrainerMyClasses;
