/**
 * AdminCalendarView — Admin → View Calendar.
 *
 * Container with a view toggle:
 *   - "Calendar" (in-app TMS calendar, FullCalendar) — DEFAULT
 *   - "Google Calendar" (the embedded Google view + event search)
 * The choice is remembered across refreshes (localStorage).
 */
import React, { useEffect, useState } from 'react';
import InAppCalendar from './InAppCalendar';
import GoogleCalendarEmbed from './GoogleCalendarEmbed';

type CalView = 'inapp' | 'google';
const STORAGE_KEY = 'admin.calendar.view';

const AdminCalendarView: React.FC = () => {
  const [view, setView] = useState<CalView>('inapp');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'google' || saved === 'inapp') setView(saved);
    } catch { /* ignore */ }
  }, []);

  const choose = (v: CalView) => {
    setView(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-on-surface">Calendar</h1>
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <button type="button" onClick={() => choose('inapp')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'inapp' ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            Calendar
          </button>
          <button type="button" onClick={() => choose('google')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'google' ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            Google Calendar
          </button>
        </div>
      </div>

      {view === 'inapp' ? <InAppCalendar /> : <GoogleCalendarEmbed />}
    </div>
  );
};

export default AdminCalendarView;
