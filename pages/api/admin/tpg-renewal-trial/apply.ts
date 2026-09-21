import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@lib/auth/withAuth';
import { applyTrialPlan } from '@lib/tpg/renewalTrial';
import { readTrialJob, saveTrialAudit } from '@lib/tpg/renewalTrialJobs';
import { guardRenewalTrial, reportTrialError } from '@lib/tpg/renewalTrialRequest';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
  if (!guardRenewalTrial(req, res)) return;
  let directory: string | null = null;
  let planHash: string | null = null;
  try {
    const { jobId, confirmPlanHash } = req.body ?? {};
    const job = await readTrialJob(String(jobId ?? ''), (req as any).authUser.id);
    directory = job.directory;
    planHash = job.plan.planHash;
    const audit = await applyTrialPlan(job.plan, String(confirmPlanHash ?? ''));
    let auditWarning: string | null = null;
    try {
      await saveTrialAudit(directory, audit);
    } catch (error) {
      auditWarning = 'Database commit succeeded, but saving the audit file failed. Contact an administrator before another refresh.';
      console.error('TPG renewal trial audit file error after commit:', error);
    }
    return res.status(200).json({ success: true, audit, auditWarning });
  } catch (error) {
    if (directory) {
      await saveTrialAudit(directory, {
        schemaVersion: 1, kind: 'tpg-renewal-database-apply-audit',
        createdAt: new Date().toISOString(), committed: false, planHash,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    }
    reportTrialError(res, error);
  }
}

export default withAuth(handler, { roles: ['admin', 'developer'] });
