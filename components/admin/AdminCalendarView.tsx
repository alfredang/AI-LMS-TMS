import React, { useEffect, useState } from 'react';

interface CalendarConfig {
  enabled: boolean;
  calendarUrl: string;
}

function getCalendarEmbedUrl(input: string): string {
  if (!input) return '';

  // Google Calendar: embed URL — set to AGENDA mode
  if (input.includes('calendar.google.com/calendar/embed')) {
    try {
      const url = new URL(input);
      url.searchParams.set('mode', 'AGENDA');
      return url.toString();
    } catch {
      return input;
    }
  }

  // Google Calendar: ?cid= subscribe link — decode base64 calendar ID
  if (input.includes('calendar.google.com') && input.includes('cid=')) {
    try {
      const url = new URL(input);
      const cid = url.searchParams.get('cid');
      if (cid) {
        const calendarId = encodeURIComponent(atob(cid));
        return `https://calendar.google.com/calendar/embed?src=${calendarId}&mode=AGENDA&showTitle=1&showNav=1&showDate=1&showPrint=0&showTabs=1&showCalendars=0&showTz=1`;
      }
    } catch {
      // Fall through
    }
  }

  // Outlook / Microsoft — use as-is
  if (input.includes('outlook.office365.com') || input.includes('outlook.live.com')) {
    return input;
  }

  // Any other embed URL — use as-is
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return input;
  }

  // Assume it's a Google Calendar ID (e.g. email)
  const calendarId = encodeURIComponent(input.trim());
  return `https://calendar.google.com/calendar/embed?src=${calendarId}&mode=AGENDA&showTitle=1&showNav=1&showDate=1&showPrint=0&showTabs=1&showCalendars=0&showTz=1`;
}

const AdminCalendarView: React.FC = () => {
  const [config, setConfig] = useState<CalendarConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/training-provider/calendar-config');
        const data = await res.json();
        if (data.success) {
          setConfig(data.data);
        }
      } catch (err) {
        console.error('Failed to fetch calendar config:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!config || !config.enabled || !config.calendarUrl) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="text-6xl mb-4">📅</div>
        <h2 className="text-xl font-bold text-on-surface mb-2">No Calendar Configured</h2>
        <p className="text-on-surface-secondary">
          Enable the calendar and add an embed URL in the Training Provider profile settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-on-surface">Calendar</h1>
        <span className="text-sm text-on-surface-secondary">
          Showing today&apos;s events by default
        </span>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <iframe
          src={getCalendarEmbedUrl(config.calendarUrl)}
          style={{ border: 0 }}
          width="100%"
          height="700"
          frameBorder="0"
          scrolling="no"
          title="Calendar"
        />
      </div>
    </div>
  );
};

export default AdminCalendarView;
