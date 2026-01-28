-- DA Application Table Migration
-- This table stores Direct Application data from SSG Excel imports
-- Primary key is application_id which serves as the unique identifier

-- Create the da_application table
CREATE TABLE IF NOT EXISTS public.da_application (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trainee_id_type character varying(50),
    trainee_id character varying(100),
    date_of_birth date,
    trainee_name character varying(255),
    course_run_id character varying(100),
    trainee_email character varying(255),
    trainee_phone_country_code character varying(10),
    trainee_phone character varying(50),
    sponsorship_type character varying(50),
    application_id character varying(100),
    payable_fee numeric(10,2),
    application_status character varying(50),
    course_title character varying(255),
    course_reference_number character varying(100),
    course_start_date date,
    course_end_date date,
    enrolment_grant character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT da_application_pkey PRIMARY KEY (id),
    CONSTRAINT da_application_unique UNIQUE (application_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_da_application_application_id ON public.da_application(application_id);
CREATE INDEX IF NOT EXISTS idx_da_application_trainee_id ON public.da_application(trainee_id);
CREATE INDEX IF NOT EXISTS idx_da_application_course_run_id ON public.da_application(course_run_id);
CREATE INDEX IF NOT EXISTS idx_da_application_trainee_email ON public.da_application(trainee_email);

-- Add trigger to auto-update updated_at timestamp
CREATE OR REPLACE TRIGGER touch_da_application_updated_at
    BEFORE UPDATE ON public.da_application
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_updated_at();

-- Comment on table
COMMENT ON TABLE public.da_application IS 'Stores Direct Application data imported from SSG Excel files';
