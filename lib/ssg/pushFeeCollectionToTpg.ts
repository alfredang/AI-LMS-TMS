/**
 * Best-effort helper: mark an enrolment as "Full Payment" on TPGateway.
 *
 * Called after a successful Pass assessment submission (ssg-create or
 * ssg-bulk-update). Admin staff are required to set full payment within
 * 7 days of SSG processing the assessment, even when cash hasn't been
 * collected yet — this automates that step.
 *
 * Never throws. Returns a structured result so callers can surface a
 * warning without failing the parent operation.
 *
 * Does NOT touch the local enrollment.payment_status column — that field
 * reflects actual payment collection and is set manually by admin staff.
 */

import { getSSGCredentialsService } from './services/credentials-service';
import { createSSGEnrolmentAPI } from './api/enrolment-api';
import { CollectionStatus } from './constants';

export type FeeCollectionPushStatus =
  | 'sent'
  | 'skipped_no_ref'
  | 'skipped_no_credentials'
  | 'error';

export interface FeeCollectionPushResult {
  status: FeeCollectionPushStatus;
  message?: string;
}

export async function pushFeeCollectionToTpg(
  enrolmentReferenceNumber: string | null | undefined
): Promise<FeeCollectionPushResult> {
  const ref = (enrolmentReferenceNumber || '').trim();
  if (!ref) {
    return { status: 'skipped_no_ref' };
  }

  try {
    const credentials = await getSSGCredentialsService().getSSGCredentials();
    if (!credentials) {
      return { status: 'skipped_no_credentials', message: 'SSG credentials not configured' };
    }

    const ssgBaseUrl = process.env.SSG_API_URL || 'https://api.ssg-wsg.sg';
    const api = createSSGEnrolmentAPI(ssgBaseUrl, credentials);

    const result = await api.updateFeeCollection(ref, {
      enrolment: { fees: { collectionStatus: CollectionStatus.FULL_PAYMENT } },
    });

    if (result.error?.code || result.error?.message) {
      const msg = result.error.message || result.error.code || 'SSG fee update failed';
      console.warn(`⚠️ [pushFeeCollectionToTpg] ${ref}: ${msg}`);
      return { status: 'error', message: msg };
    }

    console.log(`💳 [pushFeeCollectionToTpg] Full Payment set on TPG for ${ref}`);
    return { status: 'sent' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ [pushFeeCollectionToTpg] ${ref}: ${msg}`);
    return { status: 'error', message: msg };
  }
}
