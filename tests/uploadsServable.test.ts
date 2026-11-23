import test from 'node:test';
import assert from 'node:assert/strict';
import { isServableUpload, isServablePublicPath } from '../lib/uploads/servable';

test('server-only files in the uploads volume are never servable', () => {
  for (const p of [
    'training_provider/private_key/CERT_2_TMS_key.pem',
    'training_provider/ssg_app1_private_key/1_key.pem',
    'training_provider/self_signing_cert/cert.pem',
    'training_provider/service_account/1_service-account.json',
    'training_provider/private_key/renamed.png',
    'docker-compose.yaml', 'README.md', '.env',
    'announcements/x.pem', 'announcements/x.KEY', 'announcements/.hidden.pdf', 'a/b/c.p12', 'a/shell.php',
  ]) assert.equal(isServableUpload(p.split('/')), false, p);
});

test('learner and trainer documents, images and the company logo stay servable', () => {
  for (const p of [
    'announcements/1782470127984_Customers.xlsx', 'additional_documents/1_notes.pdf', 'images/1-course.jpg',
    'trainers/photo.png', 'training_provider/company_logo/logo.svg', 'training_provider/certificate_template/t.docx',
    'submissions/a/b/file.zip', 'slides/deck.pptx',
  ]) assert.equal(isServableUpload(p.split('/')), true, p);
});

test('paths relative to public/ apply the uploads rules only inside uploads/', () => {
  assert.equal(isServablePublicPath('uploads/training_provider/private_key/k.pem'), false);
  assert.equal(isServablePublicPath('uploads/../uploads/training_provider/private_key/k.pem'), false);
  assert.equal(isServablePublicPath('uploads/docker-compose.yaml'), false);
  assert.equal(isServablePublicPath('uploads/assessments/paper.pdf'), true);
  assert.equal(isServablePublicPath('ssg_templates/Enrolment_Upload_Template_V1.2.xlsx'), true);
  assert.equal(isServablePublicPath('.env'), false);
});
