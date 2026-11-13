-- Durable, idempotent audit trail for learner certificate email delivery.

CREATE TABLE IF NOT EXISTS public.certificate_delivery_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_key text NOT NULL UNIQUE,
    enrollment_id uuid REFERENCES public.enrollment(id) ON DELETE SET NULL,
    recipient_email text NOT NULL,
    certificate_url text,
    status text NOT NULL,
    request_source text NOT NULL,
    request_reason text,
    attempt_count integer NOT NULL DEFAULT 1,
    gmail_message_id text,
    error_message text,
    claimed_at timestamp with time zone NOT NULL DEFAULT now(),
    sent_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS certificate_delivery_enrollment_idx
    ON public.certificate_delivery_log (enrollment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS certificate_delivery_status_idx
    ON public.certificate_delivery_log (status, updated_at DESC);
