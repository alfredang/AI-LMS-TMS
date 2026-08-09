-- Migration: collapse the duplicate course_type labels 'non-WSQ' and 'Non-WSQ'
-- into the single canonical 'Non-WSQ'.
--
-- The enum carried both casings, which is a silent footgun: a filter or insert
-- using the wrong casing would miss or split rows. Only 'Non-WSQ' was ever used
-- in production (the lowercase label had zero rows), so this is a type-shape
-- cleanup rather than a data migration -- but the UPDATE below still runs so the
-- migration is correct on any database where the lowercase label WAS used.
--
-- Postgres has no "ALTER TYPE ... DROP VALUE", so the type is rebuilt: rename
-- the old type aside, create the correct one, re-point every dependent column
-- (rewriting values via ::text), then drop the old type. Idempotent -- re-running
-- after a successful apply is a no-op.

BEGIN;

DO $$
DECLARE
    col RECORD;
BEGIN
    -- Already merged (or never split): nothing to do.
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'course_type' AND e.enumlabel = 'non-WSQ'
    ) THEN
        RAISE NOTICE 'course_type has no lowercase ''non-WSQ'' label; nothing to merge.';
        RETURN;
    END IF;

    -- Fold any lowercase rows onto the canonical label BEFORE the type swap, so
    -- the ::text -> new-enum cast below cannot fail on an unmappable value.
    FOR col IN
        SELECT table_schema, table_name, column_name
        FROM information_schema.columns
        WHERE udt_name = 'course_type'
    LOOP
        EXECUTE format(
            'UPDATE %I.%I SET %I = %L::public.course_type WHERE %I::text = %L',
            col.table_schema, col.table_name, col.column_name,
            'Non-WSQ', col.column_name, 'non-WSQ'
        );
    END LOOP;

    ALTER TYPE public.course_type RENAME TO course_type_old;

    CREATE TYPE public.course_type AS ENUM (
        'WSQ',
        'IBF',
        'Non-WSQ',
        'CASL'
    );

    -- Re-point every dependent column at the new type. Defaults must be dropped
    -- first (a default typed as the old enum blocks the ALTER) and restored after.
    FOR col IN
        SELECT c.table_schema, c.table_name, c.column_name, c.column_default
        FROM information_schema.columns c
        WHERE c.udt_name = 'course_type_old'
    LOOP
        IF col.column_default IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I DROP DEFAULT',
                           col.table_schema, col.table_name, col.column_name);
        END IF;

        EXECUTE format(
            'ALTER TABLE %I.%I ALTER COLUMN %I TYPE public.course_type USING %I::text::public.course_type',
            col.table_schema, col.table_name, col.column_name, col.column_name
        );

        IF col.column_default IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I SET DEFAULT %s',
                           col.table_schema, col.table_name, col.column_name,
                           replace(col.column_default, 'course_type_old', 'course_type'));
        END IF;
    END LOOP;

    DROP TYPE public.course_type_old;
END $$;

COMMIT;
