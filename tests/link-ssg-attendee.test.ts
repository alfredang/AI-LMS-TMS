import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesMatch } from '../lib/attendance/linkSsgAttendee';

test('SSG name and account name of the same learner match', () => {
  assert.equal(namesMatch('Achim Ludwig Dietzenbach', 'DIETZENBACH ACHIM LUDWIG'), true);
  assert.equal(namesMatch('Peter Loh Hoe Kwong', 'LOH HOE KWONG'), true);
  assert.equal(namesMatch('Siva Chandran s/o Chandra Seagran', 'SIVA CHANDRAN S/O CHANDRA SEAGRAN'), true);
});

test('a shared surname alone is not a match', () => {
  assert.equal(namesMatch('Stanley Teo', 'TEO YEU MIN'), false);
  assert.equal(namesMatch('Tan', 'TAN AH KOW'), false);
  assert.equal(namesMatch('LIM KIAN CHUAN JOHN', 'LIM CHEE KEONG'), false);
  assert.equal(namesMatch('', 'TAN AH KOW'), false);
});
