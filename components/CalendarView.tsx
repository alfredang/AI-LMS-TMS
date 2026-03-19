import React from 'react';
import { useLms } from '@contexts/LmsContext';
import { Card } from './ui/Card';
import { Icon, IconName } from './ui/Icon';
import { CalendarEvent, UserRole } from '@app-types';

const TYPE_CONFIG: Record<string, { icon: IconName; color: string; bg: string; border: string; label: string }> = {
  quiz:       { icon: IconName.Create,    color: 'text-blue-500',   bg: 'bg-blue-100 dark:bg-blue-900/30',   border: 'border-blue-400',   label: 'Quiz' },
  assignment: { icon: IconName.Courses,   color: 'text-purple-500', bg: 'bg-purple-100 dark:bg-purple-900/30', border: 'border-purple-400', label: 'Assignment' },
  lecture:    { icon: IconName.Profile,   color: 'text-green-500',  bg: 'bg-green-100 dark:bg-green-900/30',  border: 'border-green-400',  label: 'Lecture' },
  grading:    { icon: IconName.Edit,      color: 'text-orange-500', bg: 'bg-orange-100 dark:bg-orange-900/30', border: 'border-orange-400', label: 'Grading' },
  class:      { icon: IconName.Calendar,  color: 'text-indigo-500', bg: 'bg-indigo-100 dark:bg-indigo-900/30', border: 'border-indigo-400', label: 'Class' },
  default:    { icon: IconName.Calendar,  color: 'text-gray-500',   bg: 'bg-gray-100 dark:bg-gray-700',       border: 'border-gray-400',   label: 'Event' },
};

const getConfig = (type: string) => TYPE_CONFIG[type] ?? TYPE_CONFIG.default;

const getDiffDays = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

const getRelativeLabel = (diffDays: number) => {
  if (diffDays === 0) return { label: 'Today', className: 'text-red-500 dark:text-red-400 font-semibold' };
  if (diffDays === 1) return { label: 'Tomorrow', className: 'text-orange-500 dark:text-orange-400 font-semibold' };
  if (diffDays <= 7) return { label: `In ${diffDays} days`, className: 'text-yellow-600 dark:text-yellow-400' };
  return { label: `In ${diffDays} days`, className: 'text-gray-500 dark:text-gray-400' };
};

interface Group { label: string; events: CalendarEvent[] }

const groupEvents = (events: CalendarEvent[]): Group[] => {
  const groups: Group[] = [
    { label: 'Today', events: [] },
    { label: 'This Week', events: [] },
    { label: 'Upcoming', events: [] },
  ];
  events.forEach(event => {
    const diff = getDiffDays(event.date);
    if (diff === 0) groups[0].events.push(event);
    else if (diff <= 7) groups[1].events.push(event);
    else groups[2].events.push(event);
  });
  return groups.filter(g => g.events.length > 0);
};

const CalendarView: React.FC = () => {
  const { calendarEvents, role } = useLms();

  const sortedEvents = React.useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return [...calendarEvents]
      .filter(e => new Date(e.date) >= now)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [calendarEvents]);

  const groups = groupEvents(sortedEvents);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-3xl font-bold dark:text-white">Task List</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {sortedEvents.length} upcoming {sortedEvents.length === 1 ? 'task' : 'tasks'}
        </p>
      </div>

      {sortedEvents.length === 0 ? (
        <Card className="p-12">
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-4">
              <Icon name={IconName.Calendar} className="w-8 h-8 text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-lg font-semibold text-gray-700 dark:text-gray-300">No upcoming tasks</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 max-w-xs">
              {role === UserRole.Trainer
                ? 'Your training schedule and assessment deadlines will appear here.'
                : 'Your assignments and assessments will appear here.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group.label}>
              <div className="flex items-center gap-3 mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {group.label}
                </h3>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
                  {group.events.length} {group.events.length === 1 ? 'task' : 'tasks'}
                </span>
              </div>

              <Card className="p-0 overflow-hidden">
                {group.events.map((event: CalendarEvent, idx) => {
                  const cfg = getConfig(role === UserRole.Learner ? 'assignment' : event.type);
                  const diff = getDiffDays(event.date);
                  const relative = getRelativeLabel(diff);
                  const isLast = idx === group.events.length - 1;

                  return (
                    <div
                      key={event.id}
                      className={`flex items-center gap-4 px-5 py-4 border-l-4 ${cfg.border} hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${!isLast ? 'border-b border-b-gray-100 dark:border-b-gray-700' : ''}`}
                    >
                      {/* Icon */}
                      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${cfg.bg}`}>
                        <Icon name={cfg.icon} className={`w-5 h-5 ${cfg.color}`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-gray-900 dark:text-white truncate">{event.title}</p>
                          {role === UserRole.Trainer && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                              {cfg.label}
                            </span>
                          )}
                        </div>
                        {(event as any).courseTitle && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                            {(event as any).courseTitle}
                          </p>
                        )}
                        {(event as any).description && (
                          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                            {(event as any).description}
                          </p>
                        )}
                      </div>

                      {/* Date */}
                      <div className="flex-shrink-0 text-right">
                        <p className="font-semibold text-gray-700 dark:text-gray-200 text-sm">
                          {new Date(event.date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                        <p className={`text-xs mt-0.5 ${relative.className}`}>{relative.label}</p>
                      </div>
                    </div>
                  );
                })}
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CalendarView;
