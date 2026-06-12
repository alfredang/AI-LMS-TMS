-- Backfill: flip class_status from 'Pending' to 'Confirmed' for any
-- course_run that already has a trainer assigned.
--
-- Why: prior to this change, assigning a trainer (TPG or local) did not
-- automatically confirm the class — admins had to manually flip the
-- Class Status pill from Pending → Confirmed. This one-shot backfill
-- brings historical rows in line with the new invariant:
--
--   "A course_run with any trainer (TPG, local junction, or legacy local)
--    should never be in 'Pending' status."
--
-- The UPDATE is one-directional: it ONLY touches rows where class_status
-- is currently 'Pending'. 'Cancelled' and 'Confirmed' rows are left alone.
--
-- Safe to re-run — the WHERE clause makes it idempotent.

UPDATE public.course_run cr
SET    class_status = 'Confirmed',
       updated_at   = NOW()
WHERE  cr.class_status = 'Pending'
  AND (
        -- TPG trainer assigned
        (cr.tpg_assigned_trainer_name IS NOT NULL AND TRIM(cr.tpg_assigned_trainer_name) <> '')
        OR
        -- Legacy local trainer columns populated
        (cr.assigned_trainer_name IS NOT NULL AND TRIM(cr.assigned_trainer_name) <> '')
        OR
        -- At least one row in the multi-trainer junction table
        EXISTS (
          SELECT 1 FROM public.course_run_trainer crt
          WHERE  crt.course_run_id = cr.id
        )
      );

-- Quick verification — count how many rows were affected vs left over:
-- SELECT class_status, COUNT(*) FROM course_run GROUP BY class_status ORDER BY 1;
