import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCourseRun,
  normalizeCourseRunResponse,
  toHttpErrorStatus,
} from '../lib/ssg/course-run-response';

test('extracts the canonical data.course.run response', () => {
  const run = { id: '1417167' };
  const response = { data: { course: { referenceNumber: 'TGS-1', run } } };

  assert.equal(extractCourseRun(response), run);
  assert.equal(normalizeCourseRunResponse(response).data.course.run, run);
});

test('normalizes data.run to data.course.run without losing sibling data', () => {
  const run = { id: '1128567' };
  const response = {
    status: 200,
    data: { run, virtualMeetingLink: 'https://meet.example.test/example' },
  };

  const normalized = normalizeCourseRunResponse(response) as any;

  assert.equal(normalized.data.course.run, run);
  assert.equal(normalized.data.virtualMeetingLink, response.data.virtualMeetingLink);
  assert.equal(normalized.status, 200);
});

test('normalizes root-level course.run and run variants', () => {
  const nestedRun = { id: 'nested' };
  const rootRun = { id: 'root' };

  assert.equal(
    (normalizeCourseRunResponse({ course: { run: nestedRun } }) as any).data.course.run,
    nestedRun,
  );
  assert.equal(
    (normalizeCourseRunResponse({ run: rootRun }) as any).data.course.run,
    rootRun,
  );
});

test('prefers the canonical run when multiple variants are present', () => {
  const canonicalRun = { id: 'canonical' };
  const alternateRun = { id: 'alternate' };
  const response = {
    data: {
      course: { run: canonicalRun },
      run: alternateRun,
    },
  };

  assert.equal(extractCourseRun(response), canonicalRun);
});

test('leaves error and empty responses unchanged', () => {
  const errorResponse = {
    error: { code: 'FORBIDDEN', message: 'Access denied' },
    status: 403,
  };

  assert.equal(extractCourseRun(errorResponse), null);
  assert.equal(normalizeCourseRunResponse(errorResponse), errorResponse);
  assert.equal(normalizeCourseRunResponse(null), null);
});

test('uses only valid HTTP error statuses from upstream responses', () => {
  assert.equal(toHttpErrorStatus(403), 403);
  assert.equal(toHttpErrorStatus(200), 502);
  assert.equal(toHttpErrorStatus(undefined), 502);
  assert.equal(toHttpErrorStatus(200, 500), 500);
});
