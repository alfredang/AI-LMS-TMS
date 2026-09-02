// Shared reading of course.renewed_status.
//
// The column is free text. The Renew tick on Course Funding Validity writes
// 'To Renew'; the bulk Excel upload and the course editor can write richer
// values ('Waiting For Renewal', 'Approved / Renewed', 'Rejected / Expired').
// Both the Funding Validity table and the Expired Course List classify it the
// same way so a course never reads as renewed on one page and not the other.

export type RenewClass = 'Approved' | 'Waiting' | 'Rejected' | 'ToDo' | 'Not Set';

export const classifyRenewStatus = (value?: string | null): RenewClass => {
  const v = (value || '').trim().toLowerCase();
  if (!v) return 'Not Set';
  if (v.includes('approved') || v.includes('renewed')) return 'Approved';
  if (v.includes('rejected') || v.includes('expired')) return 'Rejected';
  // 'To Renew' is a to-do, not a submission — the opposite of the others, and
  // the value the old Renew tick-box used to write. It must keep its expiry
  // warning; only a renewal actually lodged with SSG loses it.
  if (v.includes('to renew')) return 'ToDo';
  // Anything else set by hand ('Waiting For Renewal', 'Processing',
  // 'Submitted') means the renewal is with SSG and has not come back yet.
  return 'Waiting';
};

export const RENEW_BADGE_CLASSES: Record<RenewClass, string> = {
  Approved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  Waiting: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  ToDo: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'Not Set': 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

// The statuses the Renew Status dropdown offers. Blank ('') clears the column.
// Kept as the literal strings already in the database so the Expired Course
// List filter and older bulk uploads keep matching.
// The label is what people read; the value is what the column already holds, so
// existing rows and older uploads keep working. 'Waiting For Renewal' reads as
// "Renewed — Processing" because that is what it means in practice: the trainer
// has renewed it and SSG has not come back yet.
//
// 'To Renew' is deliberately NOT offered — it says nothing that 'Not Set'
// doesn't. It stays in RENEW_STATUS_VALUES so the rows that already hold it
// keep working, and it still classifies as ToDo (warning kept).
// 'Not Set' is selectable, so a status can always be taken back off a course —
// without it every change is one-way and a mis-click can only be undone from
// the database. It stores NULL, which is what a course that nobody has spoken
// for looks like.
export const RENEW_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Not Set' },
  { value: 'Waiting For Renewal', label: 'Renewed — Processing' },
  { value: 'Approved / Renewed', label: 'Approved / Renewed' },
  { value: 'Rejected / Expired', label: 'Rejected / Expired' },
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

// Everything a write is allowed to store. The first three are the dropdown's;
// 'To Renew' and 'Processing' are legacy values already in the column, kept
// writable so selecting a row's own stored value is never rejected.
export const RENEW_STATUS_VALUES: readonly string[] = [
  'Waiting For Renewal',
  'Approved / Renewed',
  'Rejected / Expired',
  'To Renew',
  'Processing',
];

export const isKnownRenewStatus = (value?: string | null) =>
  RENEW_STATUS_OPTIONS.some(option => option.value && option.value === (value || '').trim());

// A renewal that has been sent off and is still with SSG — the course is
// expiring/expired on paper but nobody needs to chase it.
export const isRenewalInFlight = (value?: string | null) => {
  const cls = classifyRenewStatus(value);
  return cls === 'Approved' || cls === 'Waiting';
};
