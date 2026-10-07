import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTraineeIdentityFields,
  normalizeTraineeIdentityType,
} from '../lib/traineeIdentity';

test('FIN number overrides contradictory Singapore Citizen identity', () => {
  assert.deepEqual(
    normalizeTraineeIdentityFields({
      nric: 'M4449163R',
      idType: 'FIN',
      identityType: 'Singapore Citizen',
    }),
    { idType: 'FIN', identityType: 'Foreigner' },
  );
});

test('foreign ID type overrides contradictory Singapore Citizen identity', () => {
  assert.equal(
    normalizeTraineeIdentityType({
      nric: '',
      idType: 'FIN/Work Permit',
      identityType: 'Singapore Citizen',
    }),
    'Foreigner',
  );
});

test('local NRIC identity remains citizen or PR when declared as local', () => {
  assert.equal(
    normalizeTraineeIdentityType({
      nric: 'S1234567A',
      idType: 'Singapore Pink Identification Card',
      identityType: 'Singapore Citizen',
    }),
    'Singapore Citizen',
  );
  assert.equal(
    normalizeTraineeIdentityType({
      nric: 'T1234567A',
      idType: 'Singapore Blue Identification Card',
      identityType: 'Singapore Permanent Resident',
    }),
    'Singapore Permanent Resident',
  );
});
