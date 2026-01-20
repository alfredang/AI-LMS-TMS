import React, { useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { CalendarEvent, UserRole } from '@app-types';

const CalendarView: React.FC = () => {
  const { calendarEvents, role } = useLms();

  // Filter out past events and sort remaining events by date in ascending order
  const sortedCalendarEvents = React.useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Set to start of today to include today's events
    
    return [...calendarEvents]
      .filter(event => new Date(event.date) >= now) // Only include today and future events
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [calendarEvents]);

  const getIconForType = (type: CalendarEvent['type']) => {
    switch (type) {
      case 'quiz':
        return <Icon name={IconName.Create} className="w-5 h-5 text-blue-500" />;
      case 'assignment':
        return <Icon name={IconName.Courses} className="w-5 h-5 text-purple-500" />;
      case 'lecture':
        return <Icon name={IconName.Profile} className="w-5 h-5 text-green-500" />;
      case 'grading':
        return <Icon name={IconName.Edit} className="w-5 h-5 text-orange-500" />;
      case 'class':
        return <Icon name={IconName.Calendar} className="w-5 h-5 text-indigo-500" />;
      default:
        return <Icon name={IconName.Calendar} className="w-5 h-5 text-gray-500" />;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Tomorrow';
    } else if (diffDays === -1) {
      return 'Yesterday';
    } else if (diffDays > 0) {
      return `In ${diffDays} days`;
    } else {
      return `${Math.abs(diffDays)} days ago`;
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold">Task List</h2>
      </div>
      
      <Card className="p-6">
        <div className="space-y-4">
          {sortedCalendarEvents.length > 0 ? (
            sortedCalendarEvents.map((event: CalendarEvent) => (
              <div 
                key={event.id} 
                className={`flex items-center p-4 rounded-lg border-l-4 border border-gray-200`}
              >
                <div className="p-3 rounded-full bg-white mr-4 shadow-sm">
                  {role === UserRole.Learner ? getIconForType('assignment') : getIconForType(event.type)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-bold text-gray-900">{event.title}</p>
                  </div>
                    {role === UserRole.Trainer && (
                    <p className="text-sm text-gray-600 capitalize">{event.type}</p>
                  )}
                  {(event as any).courseTitle && (
                    <p className="text-sm text-gray-500">Course: {(event as any).courseTitle}</p>
                  )}
                  {(event as any).description && (
                    <p className="text-sm text-gray-500 mt-1">{(event as any).description}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-semibold text-primary">
                    {new Date(event.date).toLocaleDateString('en-US', { 
                      month: 'short', 
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </p>
                  <p className="text-sm text-gray-500">
                    {formatDate(event.date)}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              <Icon name={IconName.Calendar} className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 text-lg font-medium">No upcoming tasks.</p>
              <p className="text-gray-400 text-sm mt-1">
                {role === UserRole.Trainer 
                  ? "Your training schedule and assessment deadlines will appear here."
                  : "Your assignments and assessments will appear here."
                }
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default CalendarView;
