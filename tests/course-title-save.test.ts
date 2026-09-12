import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

test('course update keeps title history in sync before commit', () => {
  const source = fs.readFileSync(path.join(root, 'pages/api/courses/update-course.ts'), 'utf8');
  const historyCall = source.indexOf('await recordRenamedTitle(courseId, courseData.title, null, client)');
  const commit = source.indexOf("await client.query('COMMIT')");

  assert.ok(historyCall >= 0, 'update-course must record the renamed title');
  assert.ok(commit > historyCall, 'title history must be updated inside the save transaction');
});

test('title-only update also keeps title history in sync', () => {
  const source = fs.readFileSync(path.join(root, 'pages/api/admin/update-course-title.ts'), 'utf8');

  assert.match(source, /await recordRenamedTitle\(id, title, null, client\)/);
  assert.doesNotMatch(source, /UPDATE public\.course SET title/);
});

test('course editor verifies the persisted title after save', () => {
  const source = fs.readFileSync(path.join(root, 'components/CourseEditor.tsx'), 'utf8');

  assert.match(source, /cache:\s*'no-store'/);
  assert.match(source, /savedCourse\.title\?\.trim\(\)\s*!==\s*courseData\.title\.trim\(\)/);
  assert.match(source, /setCourse\(savedCourse\)/);
  assert.match(source, /setEditingCourse\(savedCourse\)/);
});

test('generic course fields use functional state updates', () => {
  const source = fs.readFileSync(path.join(root, 'components/CourseEditor.tsx'), 'utf8');
  const handler = source.slice(
    source.indexOf('const handleCourseChange'),
    source.indexOf('const handleFundingDateChange')
  );

  assert.doesNotMatch(handler, /setCourse\(\{\s*\.\.\.course/);
  assert.match(handler, /setCourse\(prev\s*=>/);
});
