import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMeetLinkAgainstCalendar, meetCode } from '../lib/calendar/meetLinkRule';

// Rule 2026-11-21: for a Virtual or Hybrid class the LMS Meet link must be the Meet
// link on the class's own Google Calendar event.

const onCalendar = { eventCount: 1, meetLink: 'https://meet.google.com/ckx-tyih-akn' };

test('the calendar event\'s own Meet link is accepted', () => {
  assert.deepEqual(checkMeetLinkAgainstCalendar('https://meet.google.com/ckx-tyih-akn', onCalendar), { ok: true });
  assert.deepEqual(checkMeetLinkAgainstCalendar(' https://meet.google.com/CKX-tyih-akn?authuser=0 ', onCalendar), { ok: true });
});

test('a different Meet room is rejected and the calendar link is returned', () => {
  const r = checkMeetLinkAgainstCalendar('https://meet.google.com/abc-defg-hij', onCalendar);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'mismatch');
    assert.equal(r.calendarLink, onCalendar.meetLink);
    assert.match(r.message, /ckx-tyih-akn/);
  }
});

test('a Meet link is rejected when the calendar event has no Meet', () => {
  const r = checkMeetLinkAgainstCalendar('https://meet.google.com/abc-defg-hij', { eventCount: 1, meetLink: null });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'not_on_calendar');
});

test('nothing to compare with: calendar unreadable or no event for the run yet', () => {
  assert.deepEqual(checkMeetLinkAgainstCalendar('https://meet.google.com/abc-defg-hij', null), { ok: true });
  assert.deepEqual(checkMeetLinkAgainstCalendar('https://meet.google.com/abc-defg-hij', { eventCount: 0, meetLink: null }), { ok: true });
});

test('the rule covers Google Meet only: Zoom, Teams and clearing pass', () => {
  assert.deepEqual(checkMeetLinkAgainstCalendar('https://zoom.us/j/123456789', onCalendar), { ok: true });
  assert.deepEqual(checkMeetLinkAgainstCalendar('https://teams.microsoft.com/l/meetup-join/x', onCalendar), { ok: true });
  assert.deepEqual(checkMeetLinkAgainstCalendar('', onCalendar), { ok: true });
  assert.equal(meetCode('https://meet.google.com/ckx-tyih-akn'), 'ckx-tyih-akn');
  assert.equal(meetCode('https://example.com/meet.google.com/ckx-tyih-akn'), null);
});
