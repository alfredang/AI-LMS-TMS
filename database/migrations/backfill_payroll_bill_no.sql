-- Migration: Backfill Bill No across every existing trainer payout
--
-- Bill numbers were originally issued only when a payout was marked as paid.
-- They are now issued for EVERY payout row (see lib/payroll/billNo.ts), so the
-- whole table is numbered the way the legacy spreadsheet was. This migration
-- assigns refs to the rows that predate that change.
--
-- Ordering reproduces the spreadsheet: walk all payouts oldest-first by CLASS
-- date and number them TX<YYMMDD><NN>, restarting the NN sequence each day.
-- WSQ (trainer_payout) and non-WSQ (payroll_manual_class) share one sequence
-- per day, so a day's bills form a single continuous run across both tables.
--
-- Within a day the tie-break is (course code, run code / class title, id) —
-- deterministic, so a re-run on a restored copy of the DB produces the same
-- numbers rather than reshuffling them.
--
-- Rows that ALREADY have a bill_no are never touched or renumbered; the new
-- numbers continue past the highest suffix already used for that day. Rows with
-- no usable class date are skipped (there is no date to derive a ref from).
--
-- Safe to run repeatedly: the second run finds nothing left to fill.

BEGIN;

WITH
-- Every payout still needing a ref, from both tables, with its class date.
unnumbered AS (
    SELECT
        'wsq'::text        AS src,
        tp.id              AS id,
        cr.start_date      AS class_date,
        COALESCE(c.course_code, '')    AS sort_a,
        COALESCE(cr.course_run_id, '') AS sort_b
      FROM trainer_payout tp
      JOIN course_run cr ON cr.id = tp.course_run_id
      LEFT JOIN course c ON c.id = cr.course_id
     WHERE tp.bill_no IS NULL
       AND cr.start_date IS NOT NULL

    UNION ALL

    SELECT
        'manual'::text,
        pmc.id,
        pmc.start_date,
        COALESCE(pmc.course_code, ''),
        COALESCE(pmc.class_title, '')
      FROM payroll_manual_class pmc
     WHERE pmc.bill_no IS NULL
       AND pmc.start_date IS NOT NULL
),
-- Highest suffix already issued for each of those days, so backfilled numbers
-- continue the run instead of colliding with a ref assigned earlier.
used AS (
    SELECT day_prefix, MAX(suffix) AS max_suffix
      FROM (
        SELECT substring(bill_no FROM 1 FOR 8) AS day_prefix,
               NULLIF(regexp_replace(substring(bill_no FROM 9), '\D', '', 'g'), '')::bigint AS suffix
          FROM trainer_payout
         WHERE bill_no IS NOT NULL
        UNION ALL
        SELECT substring(bill_no FROM 1 FOR 8),
               NULLIF(regexp_replace(substring(bill_no FROM 9), '\D', '', 'g'), '')::bigint
          FROM payroll_manual_class
         WHERE bill_no IS NOT NULL
      ) x
     GROUP BY day_prefix
),
-- Number each day's rows, continuing past whatever that day already used.
numbered AS (
    SELECT
        u.src,
        u.id,
        'TX' || to_char(u.class_date, 'YYMMDD')
             || lpad((COALESCE(d.max_suffix, 0)
                      + row_number() OVER (PARTITION BY u.class_date
                                           ORDER BY u.sort_a, u.sort_b, u.id))::text,
                     2, '0') AS bill_no
      FROM unnumbered u
      LEFT JOIN used d
             ON d.day_prefix = 'TX' || to_char(u.class_date, 'YYMMDD')
)
, upd_wsq AS (
    UPDATE trainer_payout t
       SET bill_no = n.bill_no
      FROM numbered n
     WHERE n.src = 'wsq' AND t.id = n.id
    RETURNING 1
)
UPDATE payroll_manual_class m
   SET bill_no = n.bill_no
  FROM numbered n
 WHERE n.src = 'manual' AND m.id = n.id;

COMMIT;
