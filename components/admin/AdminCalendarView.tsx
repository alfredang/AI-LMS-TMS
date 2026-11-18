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
        <div className="flex gap-1 p-1 bg-surface-elevated rounded-lg">
          <button type="button" onClick={() => choose('inapp')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'inapp' ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-on-surface'}`}>
            Calendar
          </button>
          <button type="button" onClick={() => choose('google')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'google' ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-on-surface'}`}>
            Google Calendar
          </button>
        </div>
      </div>

      {view === 'inapp' ? <InAppCalendar /> : <GoogleCalendarEmbed />}
    </div>
  );
};

export default AdminCalendarView;
