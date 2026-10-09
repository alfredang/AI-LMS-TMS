import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDirectApplicationPages } from '../lib/directApplicationPagination';

test('TPG pagination starts at page 1, deduplicates overlaps and fetches the final page', async () => {
  const requested: number[] = [];
  const result = await collectDirectApplicationPages(async page => {
    requested.push(page);
    return { data: { courseApplications: (page === 1 ? ['a', 'b'] : page === 2 ? ['b', 'c'] : ['d']).map(applicationId => ({ applicationId })) }, meta: { total: 4 } };
  }, 2);
  assert.deepEqual(requested, [1, 2, 3]);
  assert.equal(result.applications.length, 4);
});
test('repeated TPG pages fail closed', async () => {
  await assert.rejects(collectDirectApplicationPages(async () => ({ data: { courseApplications: [{ applicationId: 'a' }] }, meta: { total: 2 } }), 1), /repeated/);
});
test('truncated TPG results cannot claim success', async () => {
  await assert.rejects(collectDirectApplicationPages(async () => ({ data: { courseApplications: [{ applicationId: 'a' }] }, meta: { total: 3 } }), 2), /Incomplete/);
});
test('missing list, API errors and anonymous applications fail closed', async () => {
  await assert.rejects(collectDirectApplicationPages(async () => ({}), 100), /list is missing/);
  await assert.rejects(collectDirectApplicationPages(async () => ({ error: { message: 'Rejected' }, status: 200 }), 100), /Rejected/);
  await assert.rejects(collectDirectApplicationPages(async () => ({ data: { courseApplications: [{}] } }), 100), /without an ID/);
});
test('page limit fails closed, valid empty response succeeds', async () => {
  await assert.rejects(collectDirectApplicationPages(async page => ({ data: { courseApplications: [{ applicationId: `${page}` }] } }), 1, 2), /limit reached/);
  const result = await collectDirectApplicationPages(async () => ({ data: { courseApplications: [] }, meta: { total: 0 }, status: 404 }), 100);
  assert.equal(result.applications.length, 0);
  const emptyError = await collectDirectApplicationPages(async () => ({ data: { courseApplications: [] }, error: {}, status: 200 }), 100);
  assert.equal(emptyError.applications.length, 0);
});
