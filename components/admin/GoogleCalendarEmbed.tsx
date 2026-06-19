import React, { useEffect, useState, useCallback } from 'react';

/**
 * GoogleCalendarEmbed — the original "View Calendar" experience: a Google Calendar
 * iframe embed (AGENDA mode) plus a Google-events search box. Kept as the alternate
 * toggle inside AdminCalendarView (the in-app TMS calendar is now the default).
 * Extracted verbatim from the previous AdminCalendarView.
 */

interface CalendarConfig {
  enabled: boolean;
  calendarUrl: string;
}

interface CalendarAttendee {
  email: string;
  name: string;
  status: string;
  organizer: boolean;
}

interface CalendarEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  meetLink: string;
  attendees: CalendarAttendee[];
  creator: string;
  organizer: string;
  htmlLink: string;
  status: string;
}

function getCalendarEmbedUrl(input: string): string {
  if (!input) return '';
  if (input.includes('calendar.google.com/calendar/embed')) {
    try {
      const url = new URL(input);
      url.searchParams.set('mode', 'AGENDA');
      return url.toString();
    } catch { return input; }
  }
  if (input.includes('calendar.google.com') && input.includes('cid=')) {
    try {
      const url = new URL(input);
      const cid = url.searchParams.get('cid');
      if (cid) {
        const calendarId = encodeURIComponent(atob(cid));
        return `https://calendar.google.com/calendar/embed?src=${calendarId}&mode=AGENDA&showTitle=1&showNav=1&showDate=1&showPrint=0&showTabs=1&showCalendars=0&showTz=1`;
      }
    } catch { /* fall through */ }
  }
  if (input.includes('outlook.office365.com') || input.includes('outlook.live.com')) return input;
  if (input.startsWith('http://') || input.startsWith('https://')) return input;
  const calendarId = encodeURIComponent(input.trim());
  return `https://calendar.google.com/calendar/embed?src=${calendarId}&mode=AGENDA&showTitle=1&showNav=1&showDate=1&showPrint=0&showTabs=1&showCalendars=0&showTz=1`;
}

const statusColors: Record<string, string> = {
  accepted: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  declined: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  tentative: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  needsAction: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
};

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (dateStr.length === 10) {
    return d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  return d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
}

const GoogleCalendarEmbed: React.FC = () => {
  const [config, setConfig] = useState<CalendarConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<CalendarEvent[] | null>(null);
  const [searchError, setSearchError] = useState('');
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/training-provider/calendar-config');
        const data = await res.json();
        if (data.success) setConfig(data.data);
      } catch (err) {
        console.error('Failed to fetch calendar config:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError('');
    setSearchResults(null);
    setExpandedEvent(null);
    try {
      const res = await fetch(`/api/calendar/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.success) setSearchResults(data.data);
      else setSearchError(data.error || 'Search failed.');
    } catch (err) {
      setSearchError('Failed to search calendar events.');
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleSearch(); };
  const clearSearch = () => { setSearchQuery(''); setSearchResults(null); setSearchError(''); setExpandedEvent(null); };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div></div>;
  }

  if (!config || !config.enabled || !config.calendarUrl) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="text-6xl mb-4">📅</div>
        <h2 className="text-xl font-bold text-on-surface mb-2">No Calendar Configured</h2>
        <p className="text-on-surface-secondary">Enable the calendar and add an embed URL in the Training Provider profile settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <span className="text-sm text-on-surface-secondary">Showing today&apos;s events by default</span>
      </div>

      {/* Search Bar */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Search by course code, title, name, date..."
              className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-slate-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
            />
            {searchQuery && (
              <button onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
          <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2">
            {searching ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : 'Search'}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Searches Google Calendar events from the past 6 months to 3 months ahead</p>
      </div>

      {searchError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4"><p className="text-sm text-red-700 dark:text-red-300">{searchError}</p></div>
      )}

      {searchResults !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-on-surface">Search Results
              <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">({searchResults.length} event{searchResults.length !== 1 ? 's' : ''} found)</span>
            </h2>
            <button onClick={clearSearch} className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium">Clear results</button>
          </div>
          {searchResults.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
              <div className="text-4xl mb-2">🔍</div>
              <p className="text-gray-600 dark:text-gray-400">No events found matching &quot;{searchQuery}&quot;</p>
            </div>
          ) : (
            <div className="space-y-2">
              {searchResults.map(event => {
                const isExpanded = expandedEvent === event.id;
                return (
                  <div key={event.id} className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <button onClick={() => setExpandedEvent(isExpanded ? null : event.id)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                      <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">{event.title}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{formatDateTime(event.start)}{event.end && ` — ${formatDateTime(event.end)}`}</p>
                      </div>
                      {event.attendees.length > 0 && (<span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{event.attendees.length} attendee{event.attendees.length !== 1 ? 's' : ''}</span>)}
                    </button>
                    {isExpanded && (
                      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-4 space-y-4">
                        {event.description && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Description</h4>
                            <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words max-h-40 overflow-y-auto" dangerouslySetInnerHTML={{ __html: event.description }} />
                          </div>
                        )}
                        {event.location && (<div><h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Location</h4><p className="text-sm text-gray-700 dark:text-gray-300">{event.location}</p></div>)}
                        {event.meetLink && (<div><h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Google Meet</h4><a href={event.meetLink} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 dark:text-blue-400 hover:underline break-all">{event.meetLink}</a></div>)}
                        {event.organizer && (<div><h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Organizer</h4><p className="text-sm text-gray-700 dark:text-gray-300">{event.organizer}</p></div>)}
                        {event.attendees.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Attendees ({event.attendees.length})</h4>
                            <div className="space-y-1.5">
                              {event.attendees.map((a, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm">
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${statusColors[a.status] || statusColors.needsAction}`}>{a.status === 'needsAction' ? 'pending' : a.status}</span>
                                  <span className="text-gray-700 dark:text-gray-300 truncate">{a.name ? `${a.name} (${a.email})` : a.email}</span>
                                  {a.organizer && (<span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase">organizer</span>)}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {event.htmlLink && (
                          <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                            <a href={event.htmlLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium">
                              Open in Google Calendar
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <iframe src={getCalendarEmbedUrl(config.calendarUrl)} style={{ border: 0 }} width="100%" height="700" frameBorder="0" scrolling="no" title="Calendar" />
      </div>
    </div>
  );
};

export default GoogleCalendarEmbed;
