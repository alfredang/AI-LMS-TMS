-- Receivables Reconciliation (Finance): saved overdue-breakdown snapshots.
-- Also created at runtime by ensureReceivablesReconSchema() in lib/services/receivablesRecon/reconJob.ts.
CREATE TABLE IF NOT EXISTS public.receivables_recon_snapshot (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  kind text NOT NULL DEFAULT 'quickbooks',
  overdue_total numeric(14,2) NOT NULL,
  invoice_count int NOT NULL,
  result jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receivables_recon_snapshot_created
  ON public.receivables_recon_snapshot(created_at DESC);
