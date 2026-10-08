export const TRAINEE_IDENTITY_TYPE = {
  CITIZEN: 'Singapore Citizen',
  PR: 'Singapore Permanent Resident',
  FOREIGNER: 'Foreigner',
} as const;

const NRIC_PATTERN = /^[ST]\d{7}[A-Z]$/;
const FIN_PATTERN = /^[FGM]\d{7}[A-Z]$/;

const FOREIGN_ID_TYPE_MARKERS = [
  'fin',
  'work permit',
  'employment pass',
  'e-pass',
  's pass',
  'passport',
  'foreigner',
];

const PR_MARKERS = ['permanent resident', 'singapore pr', 'blue'];
const CITIZEN_MARKERS = ['citizen', 'pink'];

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function hasAnyMarker(value: string, markers: string[]): boolean {
  const lower = value.toLowerCase();
  return markers.some(marker => lower.includes(marker));
}

export function inferTraineeIdType(nric: unknown, idType: unknown): string {
  const id = normalizeText(nric).toUpperCase();
  const declared = normalizeText(idType);

  if (FIN_PATTERN.test(id) || hasAnyMarker(declared, FOREIGN_ID_TYPE_MARKERS)) return 'FIN';
  if (NRIC_PATTERN.test(id)) return 'NRIC';
  if (hasAnyMarker(declared, ['nric', 'pink', 'blue'])) return 'NRIC';

  return declared;
}

export function normalizeTraineeIdentityType(input: {
  nric?: unknown;
  idType?: unknown;
  identityType?: unknown;
}): string {
  const id = normalizeText(input.nric).toUpperCase();
  const idType = normalizeText(input.idType);
  const identityType = normalizeText(input.identityType);
  const declared = `${idType} ${identityType}`;

  // FIN is issued to foreigners, so it must override a contradictory
  // uploaded citizenship field such as "Singapore Citizen".
  if (FIN_PATTERN.test(id) || hasAnyMarker(idType, FOREIGN_ID_TYPE_MARKERS)) {
    return TRAINEE_IDENTITY_TYPE.FOREIGNER;
  }

  if (hasAnyMarker(declared, PR_MARKERS)) return TRAINEE_IDENTITY_TYPE.PR;
  if (hasAnyMarker(declared, CITIZEN_MARKERS)) return TRAINEE_IDENTITY_TYPE.CITIZEN;

  return identityType;
}

export function normalizeTraineeIdentityFields(input: {
  nric?: unknown;
  idType?: unknown;
  identityType?: unknown;
}): { idType: string; identityType: string } {
  const idType = inferTraineeIdType(input.nric, input.idType);
  const identityType = normalizeTraineeIdentityType({
    nric: input.nric,
    idType,
    identityType: input.identityType,
  });

  return { idType, identityType };
}
