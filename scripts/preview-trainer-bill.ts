/**
 * Preview a trainer billing invoice PDF without touching QuickBooks.
 *
 *   npx tsx scripts/preview-trainer-bill.ts
 *   npx tsx scripts/preview-trainer-bill.ts --amount 280.50 --trainer "Jane Tan"
 *
 * Writes ./bill-preview.pdf so the layout can be checked after a change.
 *
 * With --drive it ALSO uploads to the Payroll invoices folder on Google Drive,
 * exercising the real upload path (credentials, folder permissions, name
 * dedup). That writes a real file to a real folder, so it is opt-in — delete
 * the file from Drive afterwards. Requires Google credentials in .env.local.
 *
 * Never talks to QuickBooks either way.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { buildTrainerBillPdf, buildTrainerBillPdfFileName } from '../lib/payroll/trainerBillPdf';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const billNo = arg('bill-no', 'TX26072708');
  const trainerName = arg('trainer', 'MOHAN POTHULA RAO');

  // Real letterhead (logo, address, registration number) from training_provider,
  // so the preview matches what a live bill will look like. Falls back to a
  // plain header if the DB is unreachable.
  const { loadBillBranding } = await import('../lib/payroll/billBranding');
  const branding = await loadBillBranding();
  console.log(
    `Branding: ${branding.companyName}` +
      `${branding.registrationNo ? ` (Reg. ${branding.registrationNo})` : ''}` +
      `${branding.logo ? ' + logo' : ' — no logo'}`
  );

  const pdf = await buildTrainerBillPdf({
    billNo,
    billDate: arg('date', '2026-07-27'),
    trainerName,
    courseTitle: arg('course', 'Certified Kubernetes Application Developer (CKAD) Training'),
    courseCode: arg('code', 'TGS-2025053212'),
    amount: Number(arg('amount', '2000')),
    paidAmount: Number(arg('paid', '0')),
    branding,
  });

  const out = path.resolve(process.cwd(), 'bill-preview.pdf');
  fs.writeFileSync(out, pdf);
  console.log(`PDF   ${out}  (${pdf.length} bytes)`);
  console.log(`Drive name would be: ${buildTrainerBillPdfFileName(billNo, trainerName)}`);

  if (!process.argv.includes('--drive')) {
    console.log('\nNot uploaded. Pass --drive to also file it in Google Drive.');
    return;
  }

  // Imported lazily so the default (safe) run never even loads the Drive client.
  const { uploadInvoicePdfToDrive, getTrainerBillsFolderId } = await import(
    '../lib/services/invoiceDriveUpload'
  );
  const folderId = await getTrainerBillsFolderId();
  console.log(`\nUploading to folder ${folderId} …`);
  const uploaded = await uploadInvoicePdfToDrive({
    pdf,
    fileName: buildTrainerBillPdfFileName(billNo, trainerName),
    folderId,
  });
  console.log(`Drive fileId: ${uploaded.fileId}`);
  console.log(`View link:    ${uploaded.webViewLink}`);
  console.log('\nThis is a REAL file. Delete it from Drive when you are done.');
}

main().catch((e) => {
  console.error('\npreview-trainer-bill failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
