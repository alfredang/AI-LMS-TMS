-- Migration: add_masterlist_table
-- Flat master list table. Each row is one trainee entry.
-- Rows belonging to the same class block share the same class_id.

CREATE TABLE IF NOT EXISTS public.masterlist_table (
    id              uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,

    -- Class grouping
    class_id        uuid NOT NULL,
    class_type      text NOT NULL,   -- virtual | evening | external | woodsSquare | reschedule | cancelled
    list_date       date,            -- the date this entry is filed under

    -- Class header fields (repeated per row)
    course_title    text,
    trainer         text,
    trainer_email   text,
    qr_attendance   text,
    zoom_id         text,
    meeting_id      text,

    -- Trainee columns
    name            text,
    contact_no      text,
    email           text,
    magento_order_no text,
    virtual_reschedule text,
    comments        text,
    entry_date      text,
    "grant"         text,
    invoice_no      text,
    payment_mode    text,
    course_fee      text,
    nett_fee        text,
    payment_status  text,
    followup_by     text,
    remark          text,
    invoice_no_color   text,
    payment_mode_color text,
    schedule_entries jsonb DEFAULT '[]'::jsonb NOT NULL,

    created_at      timestamp with time zone DEFAULT now() NOT NULL,
    updated_at      timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_masterlist_class_id   ON public.masterlist_table(class_id);
CREATE INDEX IF NOT EXISTS idx_masterlist_class_type ON public.masterlist_table(class_type);
CREATE INDEX IF NOT EXISTS idx_masterlist_list_date  ON public.masterlist_table(list_date);
