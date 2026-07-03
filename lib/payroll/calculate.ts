export interface PayoutTier {
  minPax: number;
  maxPax: number | null;
  percent: number;
}

export const DEFAULT_PAYOUT_TIERS: PayoutTier[] = [
  { minPax: 1, maxPax: 1, percent: 70 },
  { minPax: 2, maxPax: 2, percent: 60 },
  { minPax: 3, maxPax: 4, percent: 50 },
  { minPax: 5, maxPax: null, percent: 40 },
];

export function findTier(numLearners: number, tiers: PayoutTier[]): PayoutTier | null {
  for (const t of tiers) {
    const min = t.minPax;
    const max = t.maxPax;
    if (numLearners >= min && (max === null || max === undefined || numLearners <= max)) {
      return t;
    }
  }
  return null;
}

// Canonical payout formula: fee × learners × percent, rounded to cents.
// Returns 0 if any driver is non-positive. Use this everywhere a payout is
// computed from an explicit percent (manual/non-WSQ classes), so the math
// lives in exactly one place.
export function payoutAmount(numLearners: number, courseFee: number, percent: number): number {
  if (numLearners <= 0 || courseFee <= 0 || percent <= 0) return 0;
  return Math.round(courseFee * numLearners * percent) / 100;
}

export function estimatedPayout(
  numLearners: number,
  courseFee: number,
  tiers: PayoutTier[]
): { tier: PayoutTier | null; amount: number } {
  if (numLearners <= 0 || courseFee <= 0) return { tier: null, amount: 0 };
  const tier = findTier(numLearners, tiers);
  if (!tier) return { tier: null, amount: 0 };
  return { tier, amount: payoutAmount(numLearners, courseFee, tier.percent) };
}

export function validateTiers(tiers: PayoutTier[]): string | null {
  if (!Array.isArray(tiers) || tiers.length === 0) return 'At least one tier is required';
  const sorted = [...tiers].sort((a, b) => a.minPax - b.minPax);
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (typeof t.minPax !== 'number' || t.minPax < 1) return `Tier ${i + 1}: minPax must be >= 1`;
    if (typeof t.percent !== 'number' || t.percent < 0 || t.percent > 100) return `Tier ${i + 1}: percent must be 0-100`;
    const isLast = i === sorted.length - 1;
    if (!isLast) {
      if (t.maxPax === null || t.maxPax === undefined) return `Tier ${i + 1}: only the last tier may have an open-ended maxPax`;
      if (t.maxPax < t.minPax) return `Tier ${i + 1}: maxPax must be >= minPax`;
      const next = sorted[i + 1];
      if (next.minPax !== t.maxPax + 1) return `Tier ${i + 1}/${i + 2}: gap or overlap between tiers`;
    }
  }
  return null;
}
