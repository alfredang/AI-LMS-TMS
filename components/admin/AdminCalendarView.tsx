import React, { useEffect, useState } from 'react';

interface CalendarConfig {
  syncGoogleCalendar: boolean;
  syncMicrosoftCalendar: boolean;
  googleCalendarUrl: string;
  msCalendarUrl: string;
}

function getGoogleCalendarEmbedUrl(input: string): string {
  // If it's already an embed URL, use as-is
  if (input.includes('calendar.google.com/calendar/embed')) {
    // Ensure mode=AGENDA is set for today's events view
    const url = new URL(input);
    url.searchParams.set('mode', 'AGENDA');
    return url.toString();
  }
  // If it's a calendar ID (e.g. email), build the embed URL
  const calendarId = encodeURIComponent(input.trim());
  return `https://calendar.google.com/calendar/embed?src=${calendarId}&mode=AGENDA&showTitle=1&showNav=1&showDate=1&showPrint=0&showTabs=1&showCalendars=0&showTz=1`;
}

function getMsCalendarEmbedUrl(input: string): string {
  // If it's already an Outlook embed URL, use as-is
  if (input.includes('outlook.office365.com') || input.includes('outlook.live.com')) {
    return input;
  }
  return input;
}

const AdminCalendarView: React.FC = () => {
  const [config, setConfig] = useState<CalendarConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'google' | 'microsoft'>('google');

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/training-provider/calendar-config');
        const data = await res.json();
        if (data.success) {
          setConfig(data.data);
          // Default to whichever calendar is enabled
          if (data.data.syncGoogleCalendar) {
            setActiveTab('google');
          } else if (data.data.syncMicrosoftCalendar) {
            setActiveTab('microsoft');
          }
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

  if (!config || (!config.syncGoogleCalendar && !config.syncMicrosoftCalendar)) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="text-6xl mb-4">📅</div>
        <h2 className="text-xl font-bold text-on-surface mb-2">No Calendar Configured</h2>
        <p className="text-on-surface-secondary">
          Enable Google Calendar or Microsoft Calendar sync in the Training Provider profile settings and add the calendar embed URL.
        </p>
      </div>
    );
  }

  const hasGoogle = config.syncGoogleCalendar && config.googleCalendarUrl;
  const hasMicrosoft = config.syncMicrosoftCalendar && config.msCalendarUrl;
  const showTabs = hasGoogle && hasMicrosoft;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-on-surface">Calendar</h1>
        <span className="text-sm text-on-surface-secondary">
          Showing today&apos;s events by default
        </span>
      </div>

      {showTabs && (
        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setActiveTab('google')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'google'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            Google Calendar
          </button>
          <button
            onClick={() => setActiveTab('microsoft')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'microsoft'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            }`}
          >
            Microsoft Calendar
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {activeTab === 'google' && hasGoogle && (
          <iframe
            src={getGoogleCalendarEmbedUrl(config.googleCalendarUrl)}
            style={{ border: 0 }}
            width="100%"
            height="700"
            frameBorder="0"
            scrolling="no"
            title="Google Calendar"
          />
        )}
        {activeTab === 'microsoft' && hasMicrosoft && (
          <iframe
            src={getMsCalendarEmbedUrl(config.msCalendarUrl)}
            style={{ border: 0 }}
            width="100%"
            height="700"
            frameBorder="0"
            scrolling="no"
            title="Microsoft Calendar"
          />
        )}
        {activeTab === 'google' && !hasGoogle && config.syncGoogleCalendar && (
          <div className="flex items-center justify-center h-96 text-on-surface-secondary">
            Google Calendar URL not configured. Add the embed URL in Training Provider settings.
          </div>
        )}
        {activeTab === 'microsoft' && !hasMicrosoft && config.syncMicrosoftCalendar && (
          <div className="flex items-center justify-center h-96 text-on-surface-secondary">
            Microsoft Calendar URL not configured. Add the embed URL in Training Provider settings.
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminCalendarView;
