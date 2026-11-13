import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  CertificateRequestError,
  normalizeCertificateIssueInput,
} from '../lib/services/certificateDeliveryRules';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('Orion certificate input accepts learner/course lookup with safe defaults', () => {
  const input = normalizeCertificateIssueInput({
    learner_email: ' Kenny@Example.com ',
    course: 'IoT',
  });

  assert.equal(input.learnerEmail, 'kenny@example.com');
  assert.equal(input.course, 'IoT');
  assert.equal(input.sendEmail, true);
  assert.equal(input.resend, false);
  assert.equal(input.dryRun, false);
  assert.equal(input.eligibilityMode, 'standard');
});

test('manual certificate override requires an audit reason', () => {
  assert.throws(
    () => normalizeCertificateIssueInput({ learner_email: 'kenny@example.com', manual_override: true }),
    (error: unknown) => error instanceof CertificateRequestError && error.code === 'manual_reason_required',
  );

  const input = normalizeCertificateIssueInput({
    enrollment_id: 'enrollment-uuid',
    manual_override: true,
    request_reason: 'Operations explicitly approved early issue',
  });
  assert.equal(input.eligibilityMode, 'manual');
  assert.equal(input.requestReason, 'Operations explicitly approved early issue');
});

test('certificate request rejects missing learner identity and invalid email', () => {
  assert.throws(
    () => normalizeCertificateIssueInput({ course: 'IoT' }),
    (error: unknown) => error instanceof CertificateRequestError && error.code === 'missing_learner',
  );
  assert.throws(
    () => normalizeCertificateIssueInput({ learner_email: 'not-an-email' }),
    (error: unknown) => error instanceof CertificateRequestError && error.code === 'invalid_email',
  );
});

test('Orion can resolve a learner by exact name when no email is known', () => {
  const input = normalizeCertificateIssueInput({ learner_name: 'Kenny Lee', course: 'IoT' });
  assert.equal(input.learnerName, 'Kenny Lee');
  assert.equal(input.course, 'IoT');
});

test('certificate mutation routes enforce machine or privileged-role authorization', () => {
  const external = read('pages/api/external/certificates/issue.ts');
  const bulk = read('pages/api/certificates/send.ts');
  const learner = read('pages/api/learner/generate-certificate.ts');
  const lookup = read('pages/api/certificates/index.ts');

  assert.match(external, /withServiceAuth\(handler\)/);
  assert.match(bulk, /roles: \['admin', 'trainingProvider', 'trainer', 'developer'\]/);
  assert.match(learner, /WHERE id = \$1 AND user_id = \$2/);
  assert.match(lookup, /String\(userId\) !== authUser\.id/);
});

test('Orion tool and external endpoint are published in LMS documentation', () => {
  assert.match(read('components/training-provider/ApiEndpointsView.tsx'), /\/api\/external\/certificates\/issue/);
  assert.match(read('docs/orion-certificate-tool.md'), /send_learner_certificate/);
});
