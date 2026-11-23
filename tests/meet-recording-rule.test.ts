import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoRecordingOk, classifyMeetApiError, isAutoRecordingOn, roomsNeedingAutoRecording } from '../lib/calendar/meetRecordingRule';

// Rule 2026-11-21: every Virtual or Hybrid class session on Google Meet records
// automatically (the room's auto-recording is ON).

test('only Virtual and Hybrid classes on Google Meet need auto-recording', () => {
  const meet = 'https://meet.google.com/ckx-tyih-akn';
  assert.deepEqual(roomsNeedingAutoRecording('Hybrid', [meet]), [meet]);
  assert.deepEqual(roomsNeedingAutoRecording('virtual', [meet]), [meet]);
  assert.deepEqual(roomsNeedingAutoRecording('Physical', [meet]), []);
  assert.deepEqual(roomsNeedingAutoRecording(null, [meet]), []);
  assert.deepEqual(roomsNeedingAutoRecording('Virtual', ['https://zoom.us/j/123', '', null]), []);
});

test('each room is listed once, whatever the spelling of the link', () => {
  assert.deepEqual(
    roomsNeedingAutoRecording('Virtual', [
      'https://meet.google.com/ckx-tyih-akn',
      ' https://meet.google.com/CKX-tyih-akn?authuser=0 ',
      'https://meet.google.com/abc-defg-hij',
    ]),
    ['https://meet.google.com/ckx-tyih-akn', 'https://meet.google.com/abc-defg-hij']
  );
});

test('auto-recording is read from the Meet space config', () => {
  assert.equal(isAutoRecordingOn({ config: { artifactConfig: { recordingConfig: { autoRecordingGeneration: 'ON' } } } }), true);
  assert.equal(isAutoRecordingOn({ config: { artifactConfig: { recordingConfig: { autoRecordingGeneration: 'OFF' } } } }), false);
  assert.equal(isAutoRecordingOn({ config: { accessType: 'OPEN' } }), false);
  assert.equal(isAutoRecordingOn(null), false);
});

test('a token without the Meet scope is reported as scope_missing', () => {
  const r = classifyMeetApiError(403, {
    error: { message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] },
  });
  assert.equal(r.status, 'scope_missing');
  assert.match(r.message, /Renew/);
});

test('other Meet API failures map to a reason staff can act on', () => {
  assert.equal(classifyMeetApiError(403, { error: { message: 'Google Meet REST API has not been used in project 1 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] } }).status, 'api_disabled');
  assert.equal(classifyMeetApiError(403, { error: { message: 'Permission denied on resource Space' } }).status, 'not_owner');
  assert.equal(classifyMeetApiError(404, { error: { message: 'Requested entity was not found.' } }).status, 'not_found');
  assert.equal(classifyMeetApiError(500, null).status, 'error');
});

test('only on / turned_on count as recording automatically', () => {
  assert.equal(autoRecordingOk('on'), true);
  assert.equal(autoRecordingOk('turned_on'), true);
  for (const s of ['would_turn_on', 'scope_missing', 'api_disabled', 'not_owner', 'not_found', 'error'] as const) {
    assert.equal(autoRecordingOk(s), false);
  }
});
