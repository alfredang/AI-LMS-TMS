import assert from 'node:assert/strict';
import test from 'node:test';
import { readReminderEvents, ReminderSourceUnavailableError } from '../lib/calendar/readReminderEvents';

test('all pages, including more than 500 events, are collected in the exact Singapore window', async () => {
  const calls: any[] = [];
  const events = await readReminderEvents({
    list: async params => { calls.push(params); return { data: params.pageToken ? { items: [{ id: 'last' }] } : { items: Array.from({ length: 500 }, (_, i) => ({ id: String(i) })), nextPageToken: 'next' } }; },
    get: async () => { throw new Error('Unexpected detail lookup'); },
  }, 'calendar', '2026-09-26', '2026-09-26');
  assert.equal(events.length, 501); assert.equal(events[500].id, 'last');
  assert.equal(calls[0].timeMin, '2026-09-26T00:00:00+08:00'); assert.equal(calls[0].timeMax, '2026-09-26T16:00:00.000Z');
  assert.equal(calls[1].pageToken, 'next');
});
test('page failures and repeated continuation tokens fail the whole snapshot', async () => {
  for (const fail of [true, false]) {
    await assert.rejects(readReminderEvents({
      list: async params => { if (params.pageToken && fail) throw new Error('API unavailable'); return { data: { items: [{ id: 'one' }], nextPageToken: 'same' } }; },
      get: async () => ({ data: {} }),
    }, 'calendar', '2026-09-26', '2026-09-26'), ReminderSourceUnavailableError);
  }
});
test('omitted attendees require complete exact-event lookup', async () => {
  const list = async () => ({ data: { items: [{ id: 'one', attendeesOmitted: true }] } });
  const events = await readReminderEvents({ list, get: async () => ({ data: { id: 'one', attendees: [{ email: 'trainer@example.com', responseStatus: 'accepted' }] } }) }, 'calendar', '2026-09-26', '2026-09-26');
  assert.equal(events[0].attendees?.[0].responseStatus, 'accepted');
  for (const data of [{ id: 'one', attendeesOmitted: true }, { id: 'another' }]) {
    await assert.rejects(readReminderEvents({ list, get: async () => ({ data }) }, 'calendar', '2026-09-26', '2026-09-26'), ReminderSourceUnavailableError);
  }
});
