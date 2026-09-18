// Shared reading of course.renewed_status.
//
// The column is free text. The Renew tick on Course Funding Validity writes
// 'To Renew'; the bulk Excel upload and the course editor can write richer
// values such as 'Processing', 'Approved / Renewed', and 'Rejected/Expired'.
// Both the Funding Validity table and the Expired Course List classify it the
// same way so a course never reads as renewed on one page and not the other.

export type RenewClass = 'Approved' | 'Waiting' | 'Rejected' | 'ToDo' | 'Not Set';

export const classifyRenewStatus = (value?: string | null): RenewClass => {
  const v = (value || '').trim().toLowerCase();
  if (!v) return 'Not Set';
  if (v.includes('approved') || v.includes('renewed')) return 'Approved';
  if (v.includes('rejected') || v.includes('expired')) return 'Rejected';
  // These statuses still need somebody to complete or follow up on the renewal,
  // so they keep the course's expiry warning visible.
  if (
    v.includes('to renew') ||
    v === 'others' ||
    v.includes('action required') ||
    v === 'draft' ||
    v.includes('pending sub')
  ) return 'ToDo';
  // Remaining non-final statuses ('Pending Payment', 'Processing',
  // 'Pending Ack.', plus legacy values) are already in progress.
  return 'Waiting';
};

export const RENEW_BADGE_CLASSES: Record<RenewClass, string> = {
  Approved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  Waiting: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  ToDo: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'Not Set': 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

// The statuses the Renew Status dropdown offers, in display order.
export const RENEW_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Others', label: 'Others' },
  { value: 'Pending Payment', label: 'Pending Payment' },
  { value: 'Processing', label: 'Processing' },
  { value: 'Approved / Renewed', label: 'Approved / Renewed' },
  { value: 'Action Required', label: 'Action Required' },
  { value: 'Draft', label: 'Draft' },
  { value: 'Pending Ack.', label: 'Pending Ack.' },
  { value: 'Pending Sub.', label: 'Pending Sub.' },
  { value: 'Rejected/Expired', label: 'Rejected/Expired' },
];

// How a stored status reads on screen, so every page words it the same way.
export const renewStatusLabel = (value?: string | null): string => {
  const stored = (value || '').trim();
  if (!stored) return 'Not Set';
  const match = RENEW_STATUS_OPTIONS.find(
    option => option.value && option.value.toLowerCase() === stored.toLowerCase()
  );
  return match ? match.label : stored;
};

// Everything a write is allowed to store. Legacy values stay writable so old
// rows and integrations continue to work even though they are not offered by
// the dropdown.
export const RENEW_STATUS_VALUES: readonly string[] = [
  ...RENEW_STATUS_OPTIONS.map(option => option.value),
  'Waiting For Renewal',
  'Rejected / Expired',
  'To Renew',
];

export const isKnownRenewStatus = (value?: string | null) =>
  RENEW_STATUS_OPTIONS.some(option => option.value && option.value === (value || '').trim());

// A renewal is considered lodged only when it has a real application number.
// TPG captures unresolved lookups as "NOT Found", which must continue to warn
// in the same way as an empty value.
export const hasRenewalApplicationNo = (value?: string | null): boolean => {
  const applicationNo = (value || '').trim();
  return applicationNo.length > 0 && applicationNo.toLowerCase() !== 'not found';
};

export const isWithinRenewalWarningWindow = (
  validityDate: Date | null,
  today: Date,
  windowEnd: Date,
): boolean => !!validityDate && validityDate >= today && validityDate <= windowEnd;

// A renewal that has been sent off and is still with SSG — the course is
// expiring/expired on paper but nobody needs to chase it.
export const isRenewalInFlight = (value?: string | null) => {
  const cls = classifyRenewStatus(value);
  return cls === 'Approved' || cls === 'Waiting';
};
