BEGIN;

INSERT INTO public.course_change_log
  (course_id, field, field_label, old_value, new_value, changed_by, changed_by_name, note)
SELECT id, 'renewedStatus', 'Renewal Status', renewed_status, 'Approved',
       NULL, 'Status normalization', 'Canonicalize Approved / Renewed to Approved'
FROM public.course
WHERE renewed_status = 'Approved / Renewed';

UPDATE public.course
SET renewed_status = 'Approved', updated_at = NOW()
WHERE renewed_status = 'Approved / Renewed';

COMMIT;
