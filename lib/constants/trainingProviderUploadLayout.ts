/**
 * Training provider file layout under `public/` — must stay aligned with DB columns on `training_provider`
 * (paths stored as `/uploads/training_provider/<subfolder>/<filename>`).
 *
 * Matches folder names used by POST/PUT upload handlers and the directory tree in admin (certificates, templates, logos).
 */
export const TRAINING_PROVIDER_UPLOAD_ROOT = 'uploads/training_provider';

/** Subfolders under `public/uploads/training_provider/` (same names as in DB URL paths). */
export const TRAINING_PROVIDER_ASSET_SUBFOLDERS = [
  'certificate_template',
  'company_logo',
  'invoice_template',
  'private_key',
  'pro_forma_invoice_template',
  'receipt_template',
  'self_signing_cert',
  'ssg_app1_cert',
  'ssg_app1_private_key',
  'ssg_app3_cert',
  'ssg_app3_private_key',
  'service_account',
] as const;

export type TrainingProviderAssetSubfolder = (typeof TRAINING_PROVIDER_ASSET_SUBFOLDERS)[number];

/** Form field name (formidable) → disk subfolder under TRAINING_PROVIDER_UPLOAD_ROOT */
export const TRAINING_PROVIDER_FOLDER_BY_FIELD: Record<string, TrainingProviderAssetSubfolder | 'misc'> = {
  logo: 'company_logo',
  invoiceTemplate: 'invoice_template',
  receiptTemplate: 'receipt_template',
  certificateTemplate: 'certificate_template',
  proFormaInvoiceTemplate: 'pro_forma_invoice_template',
  ssgCertFile: 'self_signing_cert',
  ssgPrivateKeyFile: 'private_key',
  ssgApp1CertFile: 'ssg_app1_cert',
  ssgApp1PrivateKeyFile: 'ssg_app1_private_key',
  ssgApp3CertFile: 'ssg_app3_cert',
  ssgApp3PrivateKeyFile: 'ssg_app3_private_key',
  serviceAccountKeyFile: 'service_account',
};

/** PEM uploads: stable filenames (no timestamp prefix) for predictable DB paths — TMS self-sign pair. */
const NO_TIMESTAMP_FOLDERS = new Set<string>(['self_signing_cert', 'private_key']);

export function trainingProviderSkipTimestampForFolder(folderName: string): boolean {
  return NO_TIMESTAMP_FOLDERS.has(folderName);
}
