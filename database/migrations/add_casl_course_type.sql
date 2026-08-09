-- Add 'CASL' to the course_type enum.
--
-- CASL sits alongside WSQ and IBF as a *funded* course type. Funding for CASL is
-- identical to WSQ; the only difference is that WSQ awards an SOA certificate and
-- CASL does not. Course titles are prefixed "CASL - " (cf. "WSQ - ", "IBF - ").
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op when the label already exists.
-- Note ADD VALUE cannot run inside a transaction block in older servers; on PG 12+
-- it is allowed as long as the new value isn't used in the same transaction, which
-- is the case here (no data is written against 'CASL' below).

ALTER TYPE public.course_type ADD VALUE IF NOT EXISTS 'CASL';
