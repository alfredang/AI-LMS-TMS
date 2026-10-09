import { randomUUID } from 'crypto';
import pool from './db';
import { withDaLock } from './daAutomationLock';
import { ensureDaAutomationTable } from './directApplicationAutomationSchema';
import type { DaPipelineResult } from './autoEnrolDirectApplications';

export const DA_AUTOMATION_TASK = 'auto_retrieve_enrol_direct_applications';
export const DA_AUTOMATION_CRON = '0 9,12,15,18 * * *';
export interface DaAutomationIssue { applicationId?: string; step: string; message: string }
export interface DaAutomationRun {
  id: string; started_at?: string; completed_at?: string; status: string;
  fetched: number; imported: number; attempted: number; enrolled: number;
  already_enrolled: number; deferred: number; error_count: number; errors: DaAutomationIssue[];
}
interface Dependencies {
  retrieve: () => Promise<{ rows: Record<string, unknown>[] }>;
  importRows: (rows: Record<string, unknown>[]) => Promise<{
    inserted: number; updated: number; errors: { row: number; error: string; application_id?: string }[];
  }>;
  process: (ids: string[]) => Promise<DaPipelineResult[]>;
}

/** Await the whole pipeline so the audit reports outcomes, not merely 'queued'. */
export async function runDirectApplicationAutomation(overrides?: Dependencies): Promise<DaAutomationRun | null> {
  await ensureDaAutomationTable();
  const dependencies = overrides ?? {
    retrieve: async () => (await import('../pages/api/admin/retrieve-da-applications')).retrieveDirectApplications({ applicationStatus: 'Confirmed' }),
    importRows: async (rows: Record<string, unknown>[]) => (await import('../pages/api/admin/upload-da-applications')).importDirectApplications(rows, { enqueue: false }),
    process: async (ids: string[]) => (await import('./autoEnrolDirectApplications')).bulkProcessDirectApplications(ids, { onlyUnenrolled: true }),
  };
  return withDaLock(pool, 'scheduled-fetch-enrol', async () => {
    // Holding the lock proves no other automation is still working. A crash's
    // unfinished record must be visible rather than displaying 'running' forever.
    await pool.query(`UPDATE da_automation_run SET status = 'interrupted', completed_at = NOW(),
      error_count = error_count + 1, errors = errors || $1::jsonb WHERE status = 'running'`,
      [JSON.stringify([{ step: 'interrupted', message: 'Previous process stopped before reporting completion; unfinished applications will be retried.' }])]);
    const report: DaAutomationRun = { id: randomUUID(), status: 'running', fetched: 0, imported: 0,
      attempted: 0, enrolled: 0, already_enrolled: 0, deferred: 0, error_count: 0, errors: [] };
    await pool.query(`INSERT INTO da_automation_run (id, status) VALUES ($1, 'running')`, [report.id]);
    let step = 'fetch';
    try {
      const { rows: fetchedRows } = await dependencies.retrieve();
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
      // Defence in depth: cancelled, unconfirmed, past and undated runs never auto-enrol.
      const rows = [...new Map(fetchedRows.filter(row =>
        String(row['Application Status'] || '').trim().toLowerCase().startsWith('confirmed') &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(row['Course Start Date'] || '')) &&
        String(row['Course Start Date']) >= today && String(row['Application ID'] || '').trim()
      ).map(row => [String(row['Application ID']), row])).values()];
      report.fetched = rows.length;
      const appIds = rows.map(row => String(row['Application ID']));
      step = 'import';
      const imported = await dependencies.importRows(rows);
      report.imported = imported.inserted + imported.updated;
      const failedImports = new Set<string>();
      for (const error of imported.errors) {
        const applicationId = error.application_id || String(rows[error.row - 1]?.['Application ID'] || '');
        failedImports.add(applicationId);
        report.errors.push({ applicationId, step, message: error.error });
      }
      // Resolve ALL fetched IDs, including unchanged imports: this heals earlier
      // manual attempts that were left pending/failed instead of losing them as duplicates.
      const existing = await pool.query(`SELECT id, application_id, enrolment_id, application_status
        FROM da_application WHERE application_id = ANY($1::text[])`, [appIds]);
      const candidates: string[] = [];
      const found = new Set<string>();
      for (const row of existing.rows) {
        found.add(row.application_id);
        if (failedImports.has(row.application_id)) continue;
        if (!String(row.application_status || '').trim().toLowerCase().startsWith('confirmed')) {
          report.errors.push({ applicationId: row.application_id, step: 'eligibility', message: 'Local status differs from TPG confirmed status; enrolment withheld.' });
        } else if (String(row.enrolment_id || '').trim()) {
          report.already_enrolled++;
        } else {
          candidates.push(row.id);
        }
      }
      for (const id of appIds) {
        if (!found.has(id) && !failedImports.has(id)) report.errors.push({ applicationId: id, step: 'import', message: 'Application was not imported (possibly a duplicate learner/course run); review manually.' });
      }
      step = 'enrol';
      report.attempted = candidates.length;
      const results = await dependencies.process(candidates);
      const resultsById = new Map(results.map(result => [result.id, result]));
      for (const id of candidates) {
        const result = resultsById.get(id);
        const applicationId = existing.rows.find(row => row.id === id)?.application_id;
        if (result?.skipped) {
          if (result.failedStep === 'already_enrolled') report.already_enrolled++;
          else report.deferred++;
          continue;
        }
        if (result?.enrolmentId) report.enrolled++;
        if (!result?.success) report.errors.push({ applicationId, step: result?.failedStep || step, message: result?.error || 'Pipeline returned no outcome' });
      }
      report.status = report.errors.length ? 'completed_with_errors' : 'completed';
    } catch (error) {
      report.status = 'failed';
      report.errors.push({ step, message: error instanceof Error ? error.message : 'Unexpected automation failure' });
    }
    report.error_count = report.errors.length;
    await pool.query(`UPDATE da_automation_run SET completed_at = NOW(), status = $2,
      fetched = $3, imported = $4, attempted = $5, enrolled = $6, already_enrolled = $7,
      deferred = $8, error_count = $9, errors = $10::jsonb WHERE id = $1`,
      [report.id, report.status, report.fetched, report.imported, report.attempted, report.enrolled,
        report.already_enrolled, report.deferred, report.error_count, JSON.stringify(report.errors)]);
    return report;
  });
}
