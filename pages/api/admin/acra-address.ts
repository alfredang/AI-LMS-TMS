import { withAuth } from '@lib/auth/withAuth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { lookupAcraEntityDetailed } from '../../../lib/services/acraEntityLookup';

/**
 * GET /api/admin/acra-address?uen=201821780H
 *
 * One company's registered address from ACRA. Read-only, nothing is stored.
 *
 * Backs the address line under each result in the company search, so an admin
 * checking whether a company is set up correctly can see where it is registered
 * without opening the Bizfile directory in another tab.
 *
 * Keyed on UEN because that is the only key ACRA's open register answers
 * reliably. Searching it by company name returns anything sharing a word —
 * "PCS Security" comes back with Jensen Security and Eagle Security — so a
 * name-based lookup would be worse than none. A company with no UEN on record
 * therefore has no address here, and says so.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const uen = String(req.query.uen || '').trim();
  if (!uen) {
    return res.status(400).json({ success: false, error: 'uen is required' });
  }

  try {
    const { status, entity } = await lookupAcraEntityDetailed(uen, { timeoutMs: 8_000, attempts: 2 });

    if (!entity) {
      return res.status(200).json({
        success: true,
        found: false,
        status,
        message:
          status === 'not_in_register'
            ? 'This UEN is not in the ACRA register.'
            : 'Could not reach ACRA just now — try again.',
      });
    }

    return res.status(200).json({
      success: true,
      found: true,
      status,
      entityName: entity.entityName,
      registrationStatus: entity.status,
      entityType: entity.entityType,
      street: entity.street,
      postalCode: entity.postalCode,
      // Pre-joined so every caller renders it the same way.
      addressLine: [entity.street, entity.postalCode ? `Singapore ${entity.postalCode}` : '']
        .filter(Boolean)
        .join(', '),
    });
  } catch (err) {
    console.error('[acra-address] error:', err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'developer'] });
