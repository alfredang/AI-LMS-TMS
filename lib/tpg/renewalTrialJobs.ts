import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RenewalPlanError } from './renewalSync';
import type { TrialAudit, TrialPlan } from './renewalTrial';

const root = () => process.env.TPG_RENEWAL_JOB_DIR || path.join(process.cwd(), 'outputs', 'tpg-renewal-trial-jobs');
const jobPath = (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new RenewalPlanError('Invalid renewal trial job ID.');
  }
  return path.join(root(), id);
};

export async function saveTrialJob(ownerId: string, captures: unknown, plan: TrialPlan): Promise<string> {
  const id = randomUUID();
  const directory = jobPath(id);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await Promise.all([
    fs.writeFile(path.join(directory, 'capture.json'), JSON.stringify(captures, null, 2), { flag: 'wx', mode: 0o600 }),
    fs.writeFile(path.join(directory, 'plan.json'), JSON.stringify({ ownerId, plan }, null, 2), { flag: 'wx', mode: 0o600 }),
  ]);
  return id;
}

export async function readTrialJob(id: string, ownerId: string): Promise<{ directory: string; plan: TrialPlan }> {
  const directory = jobPath(id);
  const document = JSON.parse(await fs.readFile(path.join(directory, 'plan.json'), 'utf8'));
  if (document.ownerId !== ownerId) throw new RenewalPlanError('This renewal preview belongs to another user.');
  const plan = document.plan as TrialPlan;
  if (!plan?.createdAt || !Number.isFinite(Date.parse(plan.createdAt)) || Date.now() - Date.parse(plan.createdAt) > 30 * 60 * 1000) {
    throw new RenewalPlanError('The renewal preview expired. Capture TPG again.');
  }
  return { directory, plan };
}

export async function saveTrialAudit(directory: string, audit: TrialAudit | Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(directory, 'apply-audit.json'), JSON.stringify(audit, null, 2), { mode: 0o600 });
}
