--
-- PostgreSQL database dump
--

\restrict KPNzHcMuzw6FCNWgTSTZDEZ2rYp7EPkK9WX1jIHroBHCJuH1Vh42QYLbtRA63fn

-- Dumped from database version 17.9
-- Dumped by pg_dump version 17.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: admin_page; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.admin_page AS ENUM (
    'Dashboard',
    'Class Management',
    'TPG Management',
    'View Courses',
    'View Trainers',
    'Upcoming Classes',
    'Ongoing Classes',
    'Completed Classes',
    'Create New Class',
    'Edit Class',
    'Enroll Learners',
    'Assign Trainer',
    'Apply New Grant',
    'View Grant Status',
    'Submit Assessment',
    'View Assessments',
    'Apply New Claim',
    'View Claim Status',
    'Upload Course Runs'
);


--
-- Name: age_group; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.age_group AS ENUM (
    'Below 20',
    '20-25',
    '26-30',
    '31-35',
    '36-40',
    '41-45',
    '46-50',
    '51-55',
    '56-60',
    '61-65',
    '66-70',
    'Above 70'
);


--
-- Name: app_view; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_view AS ENUM (
    'Dashboard',
    'Courses',
    'Calendar',
    'Create',
    'Profile',
    'Analytics',
    'Admin',
    'HelpAndSupport',
    'JobSearch'
);


--
-- Name: assessment_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.assessment_category AS ENUM (
    'Written Exam',
    'Online Exam',
    'Project',
    'Assignments',
    'Oral Interview',
    'Demonstration',
    'Practical Exam',
    'Role Play',
    'Oral Questioning'
);


--
-- Name: assessment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.assessment_status AS ENUM (
    'Draft',
    'Published'
);


--
-- Name: calendar_event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.calendar_event_type AS ENUM (
    'quiz',
    'assignment',
    'lecture',
    'event'
);


--
-- Name: chat_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.chat_role AS ENUM (
    'user',
    'model'
);


--
-- Name: class_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.class_status AS ENUM (
    'Confirmed',
    'Pending',
    'Cancelled',
    'Reschedule',
    'Unconfirmed'
);


--
-- Name: company_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.company_type AS ENUM (
    'SME',
    'MNC',
    'Government',
    'Startup',
    'N/A'
);


--
-- Name: course_payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.course_payment_status AS ENUM (
    'Paid',
    'Pending',
    'Overdue'
);


--
-- Name: course_sponsorship; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.course_sponsorship AS ENUM (
    'Individual',
    'Employer'
);


--
-- Name: course_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.course_type AS ENUM (
    'WSQ',
    'IBF',
    'non-WSQ',
    'Non-WSQ'
);


--
-- Name: developer_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.developer_type AS ENUM (
    'DACE',
    'DDDPL',
    'N/A'
);


--
-- Name: education; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.education AS ENUM (
    'Diploma',
    'Degree',
    'Master',
    'PhD'
);


--
-- Name: employment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.employment_status AS ENUM (
    'Employed',
    'Unemployed',
    'Looking for Job'
);


--
-- Name: ethnicity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ethnicity AS ENUM (
    'Chinese',
    'Malay',
    'Indian',
    'Others'
);


--
-- Name: gender; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gender AS ENUM (
    'Male',
    'Female',
    'Prefer not to say'
);


--
-- Name: grade_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grade_status AS ENUM (
    'Pass',
    'Fail',
    'Pending'
);


--
-- Name: grant_import_apply_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grant_import_apply_status AS ENUM (
    'pending',
    'applied',
    'skipped',
    'failed'
);


--
-- Name: grant_import_audit_event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grant_import_audit_event_type AS ENUM (
    'upload',
    'parse',
    'validate',
    'match',
    'apply_start',
    'apply_success',
    'apply_fail',
    'skip',
    'enrolment_status_update',
    'export'
);


--
-- Name: grant_import_batch_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grant_import_batch_status AS ENUM (
    'pending_review',
    'applying',
    'completed',
    'cancelled'
);


--
-- Name: grant_import_match_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grant_import_match_status AS ENUM (
    'ready',
    'already_applied',
    'ambiguous',
    'unmatched',
    'invalid'
);


--
-- Name: grant_import_validation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grant_import_validation_status AS ENUM (
    'valid',
    'invalid'
);


--
-- Name: grant_payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grant_payment_status AS ENUM (
    'NOT_RECEIVED',
    'PARTIAL',
    'FULLY_PAID'
);


--
-- Name: grant_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grant_status AS ENUM (
    'Pending',
    'Approved',
    'Rejected'
);


--
-- Name: learner_payment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.learner_payment_status AS ENUM (
    'Paid',
    'Unpaid'
);


--
-- Name: mode_of_learning; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mode_of_learning AS ENUM (
    'Physical',
    'Virtual',
    'Hybrid',
    'External'
);


--
-- Name: nationality; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.nationality AS ENUM (
    'Singaporean',
    'Singapore PR',
    'Non Citizen'
);


--
-- Name: qualification; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.qualification AS ENUM (
    'ACLP',
    'DACE'
);


--
-- Name: tpg_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tpg_status AS ENUM (
    'Success',
    'Pending',
    'Processing',
    'Failed',
    'N/A'
);


--
-- Name: trainer_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.trainer_status AS ENUM (
    'Active',
    'Inactive'
);


--
-- Name: trainer_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.trainer_type AS ENUM (
    'ACLP',
    'non-ACLP',
    'DACE'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'Learner',
    'Trainer',
    'Admin',
    'Developer',
    'Training Provider',
    'Finance',
    'Payroll'
);


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_profile (
    user_id uuid NOT NULL,
    tel text NOT NULL
);


--
-- Name: api_subscription; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_subscription (
    id integer NOT NULL,
    api_name character varying(255) NOT NULL,
    version character varying(50),
    app1_status character varying(50),
    app2_status character varying(50),
    app3_status character varying(50),
    app4_status character varying(50),
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: api_subscription_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_subscription_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_subscription_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_subscription_id_seq OWNED BY public.api_subscription.id;


--
-- Name: app_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_config (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: app_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password text,
    password_hash text,
    full_name text NOT NULL,
    profile_picture_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    oauth_provider character varying(50),
    oauth_provider_id character varying(255),
    supabase_user_id uuid,
    auth_provider text,
    account_status text DEFAULT 'active'::text NOT NULL,
    secondary_email text,
    courses_updated_at timestamp with time zone,
    must_change_password boolean DEFAULT false,
    additional_emails text[] DEFAULT '{}'::text[],
    CONSTRAINT email_valid CHECK ((POSITION(('@'::text) IN (email)) > 1))
);


--
-- Name: COLUMN app_user.oauth_provider; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.app_user.oauth_provider IS 'OAuth provider name (e.g., google, github)';


--
-- Name: COLUMN app_user.oauth_provider_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.app_user.oauth_provider_id IS 'Unique user ID from the OAuth provider';


--
-- Name: COLUMN app_user.supabase_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.app_user.supabase_user_id IS 'Supabase Auth user ID for OAuth users';


--
-- Name: COLUMN app_user.auth_provider; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.app_user.auth_provider IS 'Authentication provider: google, password, etc.';


--
-- Name: assessment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    title text NOT NULL,
    category public.assessment_category NOT NULL,
    status public.assessment_status NOT NULL,
    access_code text,
    file_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assessment_grade; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessment_grade (
    enrollment_id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    status public.grade_status NOT NULL
);


--
-- Name: auto_create_assessment_record_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_create_assessment_record_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    course_run_id text,
    course_title text,
    course_code text,
    start_date date,
    end_date date,
    trainer_name text,
    trainer_source text,
    folder_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text
);


--
-- Name: auto_create_assessment_record_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_create_assessment_record_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_create_assessment_record_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_create_assessment_record_log_id_seq OWNED BY public.auto_create_assessment_record_log.id;


--
-- Name: auto_create_certificates_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_create_certificates_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    course_run_id text,
    course_title text,
    course_code text,
    learner_name text,
    nric text,
    certificate_url text,
    status text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: auto_create_certificates_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_create_certificates_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_create_certificates_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_create_certificates_log_id_seq OWNED BY public.auto_create_certificates_log.id;


--
-- Name: auto_create_learner_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_create_learner_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    course_run_id text,
    course_title text,
    course_code text,
    status text DEFAULT 'pending'::text NOT NULL,
    total_enrolled integer DEFAULT 0,
    created_count integer DEFAULT 0,
    existing_count integer DEFAULT 0,
    error_count integer DEFAULT 0,
    details jsonb,
    error_message text,
    start_date date,
    end_date date
);


--
-- Name: auto_create_learner_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_create_learner_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_create_learner_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_create_learner_log_id_seq OWNED BY public.auto_create_learner_log.id;


--
-- Name: auto_create_trainer_folder_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_create_trainer_folder_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    course_run_id text,
    course_title text,
    course_code text,
    start_date date,
    end_date date,
    trainer_name text,
    trainer_source text,
    folder_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text
);


--
-- Name: auto_create_trainer_folder_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_create_trainer_folder_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_create_trainer_folder_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_create_trainer_folder_log_id_seq OWNED BY public.auto_create_trainer_folder_log.id;


--
-- Name: auto_generate_da_invoices_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_generate_da_invoices_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    application_id text,
    enrolment_id text,
    stage text NOT NULL,
    status text NOT NULL,
    failed_step text,
    message text,
    error_message text
);


--
-- Name: auto_generate_da_invoices_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_generate_da_invoices_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_generate_da_invoices_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_generate_da_invoices_log_id_seq OWNED BY public.auto_generate_da_invoices_log.id;


--
-- Name: auto_generate_proforma_invoices_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_generate_proforma_invoices_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    trigger_source text NOT NULL,
    enrollment_id uuid,
    enrolment_id text,
    learner_name text,
    course_code text,
    course_title text,
    invoice_number text,
    drive_url text,
    status text NOT NULL,
    reason text,
    error_message text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: auto_generate_proforma_invoices_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_generate_proforma_invoices_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_generate_proforma_invoices_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_generate_proforma_invoices_log_id_seq OWNED BY public.auto_generate_proforma_invoices_log.id;


--
-- Name: auto_sanitise_data_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_sanitise_data_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    table_name text NOT NULL,
    rows_scanned integer DEFAULT 0 NOT NULL,
    rows_updated integer DEFAULT 0 NOT NULL,
    cutoff_date date,
    status text NOT NULL,
    message text
);


--
-- Name: auto_sanitise_data_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_sanitise_data_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_sanitise_data_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_sanitise_data_log_id_seq OWNED BY public.auto_sanitise_data_log.id;


--
-- Name: auto_send_confirmation_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_send_confirmation_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    course_run_id text,
    course_title text,
    course_code text,
    learner_name text,
    learner_email text,
    status text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: auto_send_confirmation_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_send_confirmation_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_send_confirmation_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_send_confirmation_log_id_seq OWNED BY public.auto_send_confirmation_log.id;


--
-- Name: auto_send_course_completion_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_send_course_completion_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    course_run_id text,
    course_title text,
    course_code text,
    learner_name text,
    learner_email text,
    status text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: auto_send_course_completion_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_send_course_completion_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_send_course_completion_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_send_course_completion_log_id_seq OWNED BY public.auto_send_course_completion_log.id;


--
-- Name: auto_send_courseware_attendance_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_send_courseware_attendance_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    course_run_id text,
    course_title text,
    course_code text,
    learner_name text,
    learner_email text,
    status text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: auto_send_courseware_attendance_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_send_courseware_attendance_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_send_courseware_attendance_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_send_courseware_attendance_log_id_seq OWNED BY public.auto_send_courseware_attendance_log.id;


--
-- Name: auto_send_trainer_invitation_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_send_trainer_invitation_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    course_run_uuid uuid,
    course_run_id text,
    course_title text,
    trainer_name text,
    trainer_email text,
    status text NOT NULL,
    message text
);


--
-- Name: auto_send_trainer_invitation_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auto_send_trainer_invitation_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auto_send_trainer_invitation_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auto_send_trainer_invitation_log_id_seq OWNED BY public.auto_send_trainer_invitation_log.id;


--
-- Name: calendar_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_event (
    id bigint NOT NULL,
    course_id uuid,
    title text NOT NULL,
    date date NOT NULL,
    type public.calendar_event_type NOT NULL,
    speaker text,
    event_type text
);


--
-- Name: calendar_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.calendar_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: calendar_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.calendar_event_id_seq OWNED BY public.calendar_event.id;


--
-- Name: certification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trainer_id uuid,
    name text NOT NULL,
    file_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    original_filename text,
    developer_id uuid,
    CONSTRAINT certification_owner_check CHECK ((((trainer_id IS NOT NULL) AND (developer_id IS NULL)) OR ((trainer_id IS NULL) AND (developer_id IS NOT NULL))))
);


--
-- Name: chat_conversation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_conversation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_message; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_message (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role public.chat_role NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_application; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_application (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id character varying(100),
    trainee_id_type character varying(50),
    trainee_id character varying(100),
    date_of_birth text,
    trainee_name character varying(255),
    trainee_email character varying(255),
    trainee_phone_country_code character varying(10),
    trainee_phone character varying(50),
    highest_qualification character varying(255),
    employer_uen text,
    employer_name text,
    employer_contact_name text,
    employer_contact_designation text,
    employer_contact_email text,
    employer_phone_country_code text,
    employer_phone text,
    company_address text,
    course_title character varying(255),
    course_reference_number character varying(100),
    course_run_id character varying(100),
    course_start_date text,
    course_end_date date,
    full_course_fee numeric(10,2),
    gst numeric(10,2),
    skillsfuture_subsidy numeric(10,2),
    skillsfuture_credit numeric(10,2),
    skillsfuture_credit_claim_id character varying(100),
    application_status character varying(50) DEFAULT 'Confirm application'::character varying,
    enrolment_status text,
    enrolment_id character varying(100),
    grant_id character varying(100),
    auto_status character varying(50),
    auto_error text,
    calendar_added boolean DEFAULT false,
    company_invoice_batch_id uuid,
    grant_invoice_id character varying(100),
    grant_invoice_doc_number text,
    grant_invoice_drive_file_id text,
    grant_invoice_drive_web_view_link text,
    grant_invoice_sent_at timestamp with time zone,
    grant_invoice_sent_to text,
    qb_customer_ref character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_excel_row jsonb,
    raw_excel_columns jsonb,
    s_no integer,
    trainee_identity_type text,
    trainee_full_name text,
    trainee_nric text,
    trainee_highest_qualification text,
    employer_org_name text,
    employer_contact_phone text,
    ssg_funding_before text,
    consent_ssg_terms text,
    declaration_truthful text,
    consent_marketing text,
    grant_application_nos text,
    auto_enrol_status text,
    auto_enrol_error text,
    application_key text,
    grant_amount numeric,
    native_enrollment_id uuid,
    invoice_id text
);


--
-- Name: company_invoice_batch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_invoice_batch (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text NOT NULL,
    company_uen text,
    contact_name text,
    contact_email text,
    contact_phone text,
    qbo_invoice_id character varying(100),
    qbo_doc_number character varying(100),
    invoice_no character varying(64),
    drive_file_id text,
    drive_web_view_link text,
    status text DEFAULT 'draft'::text NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    course_reference_number character varying(100),
    course_title text,
    invoice_sent_at timestamp with time zone,
    invoice_sent_to text
);


--
-- Name: course; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text,
    image_url text,
    course_code text,
    tsc_title text,
    tsc_code text,
    tsc_knowledge text,
    tsc_abilities text,
    learning_outcomes text,
    training_hours numeric,
    assessment_hours numeric,
    difficulty text,
    mode_of_learning public.mode_of_learning,
    course_type public.course_type,
    enrollment_status text,
    status public.assessment_status,
    course_fee numeric(12,2),
    tax_percent numeric(5,2),
    is_wsq_funded boolean DEFAULT false,
    is_skills_future_eligible boolean DEFAULT false,
    is_psea_eligible boolean DEFAULT false,
    is_mces_eligible boolean DEFAULT false,
    is_ibf_funded boolean DEFAULT false,
    is_utap_eligible boolean DEFAULT false,
    start_date date,
    end_date date,
    class_status public.class_status,
    learner_guide_url text,
    slides_url text,
    lesson_plan_url text,
    assessment_plan_url text,
    facilitator_guide_url text,
    trainer_slides_url text,
    is_gamified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assessment_record_link text,
    courseware_link text,
    domain text,
    schedule_id text,
    funding_validity text,
    course_fees_exclude_gst text,
    after_normal_funding numeric(12,2),
    after_mces_funding numeric(12,2),
    num_of_days integer,
    num_of_trainers integer,
    course_link text,
    brochure_link text,
    google_classroom text,
    google_classroom_code text,
    skillsfuture_link text,
    sf_for_business_link text,
    skills_framework text,
    da boolean DEFAULT false,
    average_score numeric(5,2),
    star_rating numeric(3,1),
    num_responders integer,
    description text,
    course_outline text,
    course_fees_include_gst text,
    renewed_status text,
    practical_performance_assessment_link text,
    written_assessment_link text,
    trainers_list text,
    resource_links jsonb,
    assessment_methods jsonb,
    published_assessment_methods jsonb DEFAULT '{}'::jsonb,
    assessment_summary_record_url text,
    has_evening_class boolean DEFAULT false,
    trainers_email_list text,
    cas_score numeric(6,2),
    es_score numeric(6,2),
    whitelist_status text,
    CONSTRAINT course_assessment_hours_check CHECK ((assessment_hours >= (0)::numeric)),
    CONSTRAINT course_course_fee_check CHECK ((course_fee >= (0)::numeric)),
    CONSTRAINT course_dates CHECK ((end_date >= start_date)),
    CONSTRAINT course_enrollment_status_check CHECK ((enrollment_status = ANY (ARRAY['enrolled'::text, 'not-enrolled'::text]))),
    CONSTRAINT course_tax_percent_check CHECK ((tax_percent >= (0)::numeric)),
    CONSTRAINT course_training_hours_check CHECK ((training_hours >= (0)::numeric))
);


--
-- Name: course_announcement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_announcement (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_run_id uuid NOT NULL,
    title text,
    message text,
    link_url text,
    file_name text,
    file_url text,
    posted_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT course_announcement_has_content CHECK ((COALESCE(NULLIF(TRIM(BOTH FROM message), ''::text), NULLIF(TRIM(BOTH FROM link_url), ''::text), NULLIF(file_url, ''::text)) IS NOT NULL))
);


--
-- Name: course_attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid,
    is_present boolean DEFAULT false NOT NULL,
    reason_of_absence text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    nric text
);


--
-- Name: course_run; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    course_run_id character varying(100) NOT NULL,
    digital_attendance_id text,
    class_status public.class_status DEFAULT 'Pending'::public.class_status,
    start_date date,
    end_date date,
    mode_of_learning public.mode_of_learning,
    assigned_trainer_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_trainer_name text,
    assigned_trainer_email text,
    is_deleted boolean DEFAULT false,
    written_assessment_published boolean DEFAULT false NOT NULL,
    practical_assessment_published boolean DEFAULT false NOT NULL,
    published_assessment_methods jsonb DEFAULT '{}'::jsonb,
    assessment_methods jsonb,
    registration_opening_date date,
    registration_closing_date date,
    venue_block text,
    venue_street text,
    venue_building text,
    venue_floor text,
    venue_unit text,
    venue_postal_code text,
    venue_room text,
    venue_wheelchair_access boolean,
    course_vacancy_code text,
    course_vacancy_description text,
    course_admin_email text,
    tpg_assigned_trainer_id uuid,
    tpg_assigned_trainer_name text,
    tpg_assigned_trainer_email text,
    class_type text DEFAULT 'Physical'::text,
    virtual_meeting_link text,
    invitation_paused boolean DEFAULT false,
    invitation_replies_blocked boolean DEFAULT false,
    trainer_in_calendar boolean,
    tpg_sync_status text,
    calendar_name_mismatch boolean DEFAULT false,
    CONSTRAINT course_run_dates CHECK ((end_date >= start_date))
);


--
-- Name: course_run_assessment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_run_assessment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_run_id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    published boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone
);


--
-- Name: course_run_date_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_run_date_sync_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    course_run_id text,
    course_title text,
    course_code text,
    db_start_date text,
    db_end_date text,
    ssg_start_date text,
    ssg_end_date text,
    status text DEFAULT 'pending'::text NOT NULL,
    updated boolean DEFAULT false,
    error_message text
);


--
-- Name: course_run_date_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.course_run_date_sync_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: course_run_date_sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.course_run_date_sync_log_id_seq OWNED BY public.course_run_date_sync_log.id;


--
-- Name: course_run_trainer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_run_trainer (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_run_id uuid NOT NULL,
    trainer_id uuid,
    trainer_name text NOT NULL,
    trainer_email text,
    assigned_at timestamp with time zone DEFAULT now()
);


--
-- Name: course_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_run_id uuid NOT NULL,
    session_number text,
    ssg_session_id text,
    title text,
    start_date text,
    end_date text,
    start_time text,
    end_time text,
    mode_of_training text,
    attendance_taken boolean DEFAULT false,
    deleted boolean DEFAULT false,
    venue jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trainer_id uuid,
    trainer_name text,
    trainer_email text,
    class_type text
);


--
-- Name: COLUMN course_session.trainer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_session.trainer_id IS 'Per-session trainer override. NULL means inherit run-level trainer from course_run_trainer.';


--
-- Name: COLUMN course_session.trainer_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_session.trainer_name IS 'Cached trainer name for override, written in lock-step with trainer_id.';


--
-- Name: COLUMN course_session.trainer_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_session.trainer_email IS 'Cached trainer email for override, written in lock-step with trainer_id.';


--
-- Name: course_session_timing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_session_timing (
    id integer NOT NULL,
    course_code text NOT NULL,
    session_1_start_time text,
    session_1_end_time text,
    session_1_mode_of_training text,
    session_2_start_time text,
    session_2_end_time text,
    session_2_mode_of_training text,
    session_3_start_time text,
    session_3_end_time text,
    session_3_mode_of_training text,
    session_4_start_time text,
    session_4_end_time text,
    session_4_mode_of_training text,
    session_5_start_time text,
    session_5_end_time text,
    session_5_mode_of_training text,
    session_6_start_time text,
    session_6_end_time text,
    session_6_mode_of_training text,
    session_7_start_time text,
    session_7_end_time text,
    session_7_mode_of_training text,
    session_8_start_time text,
    session_8_end_time text,
    session_8_mode_of_training text,
    session_9_start_time text,
    session_9_end_time text,
    session_9_mode_of_training text,
    session_10_start_time text,
    session_10_end_time text,
    session_10_mode_of_training text,
    session_11_start_time text,
    session_11_end_time text,
    session_11_mode_of_training text,
    session_1_evening_start_time text,
    session_1_evening_end_time text,
    session_1_evening_mode_of_training text,
    session_2_evening_start_time text,
    session_2_evening_end_time text,
    session_2_evening_mode_of_training text,
    session_3_evening_start_time text,
    session_3_evening_end_time text,
    session_3_evening_mode_of_training text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: course_session_timing_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.course_session_timing_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: course_session_timing_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.course_session_timing_id_seq OWNED BY public.course_session_timing.id;


--
-- Name: cp_prompt_template; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cp_prompt_template (
    section text NOT NULL,
    template text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: TABLE cp_prompt_template; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cp_prompt_template IS 'CP Generator prompt overrides. One row per section; absent row means use the built-in default from lib/cp-prompts.ts.';


--
-- Name: da_application; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.da_application (
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
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    enrolment_status text,
    application_date date,
    application_cancelled_by character varying(255),
    full_course_fee numeric(10,2),
    gst numeric(10,2),
    skillsfuture_subsidy numeric(10,2),
    skillsfuture_credit numeric(10,2),
    skillsfuture_credit_claim_id character varying(100),
    highest_qualification character varying(255),
    highest_relevant_certification character varying(255),
    enrolment_id character varying(100),
    grant_id character varying(100),
    invoice_id character varying(100),
    qb_customer_ref character varying(50),
    auto_enrol_status character varying(50),
    auto_enrol_error text,
    calendar_added boolean DEFAULT false,
    grant_amount text,
    invoice_drive_file_id text,
    invoice_drive_web_view_link text,
    invoice_doc_number text,
    invoice_no text,
    sfc_invoice_drive_web_view_link text,
    sfc_invoice_drive_file_id text,
    grant_invoice_drive_file_id text,
    grant_invoice_drive_web_view_link text,
    grant_invoice_id character varying(100),
    sfc_invoice_id character varying(100),
    user_id uuid,
    employer_uen text,
    employer_name text,
    employer_contact_name text,
    employer_contact_email text,
    employer_phone_country_code text,
    employer_phone text,
    company_address text,
    company_invoice_batch_id uuid
);


--
-- Name: TABLE da_application; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.da_application IS 'Stores Direct Application data imported from SSG Excel files';


--
-- Name: COLUMN da_application.application_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.application_date IS 'Date when the application was submitted';


--
-- Name: COLUMN da_application.application_cancelled_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.application_cancelled_by IS 'Entity or person who cancelled the application';


--
-- Name: COLUMN da_application.full_course_fee; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.full_course_fee IS 'Full course fee before subsidies';


--
-- Name: COLUMN da_application.gst; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.gst IS 'GST amount';


--
-- Name: COLUMN da_application.skillsfuture_subsidy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.skillsfuture_subsidy IS 'SkillsFuture subsidy amount';


--
-- Name: COLUMN da_application.skillsfuture_credit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.skillsfuture_credit IS 'SkillsFuture credit amount used';


--
-- Name: COLUMN da_application.skillsfuture_credit_claim_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.skillsfuture_credit_claim_id IS 'SkillsFuture credit claim ID';


--
-- Name: COLUMN da_application.highest_qualification; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.highest_qualification IS 'Trainee highest qualification';


--
-- Name: COLUMN da_application.highest_relevant_certification; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.highest_relevant_certification IS 'Trainee highest relevant certification';


--
-- Name: COLUMN da_application.enrolment_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.enrolment_id IS 'SSG enrolment reference number returned by /tpg/enrolments';


--
-- Name: COLUMN da_application.grant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.grant_id IS 'SSG grant identifier from grant search';


--
-- Name: COLUMN da_application.invoice_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.invoice_id IS 'QuickBooks invoice ID for the net-fee invoice';


--
-- Name: COLUMN da_application.qb_customer_ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.qb_customer_ref IS 'Cached QuickBooks CustomerRef for the trainee (find-or-create)';


--
-- Name: COLUMN da_application.auto_enrol_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.auto_enrol_status IS 'Auto-enrol pipeline status: pending | enroled | grant_found | invoiced | failed';


--
-- Name: COLUMN da_application.auto_enrol_error; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.auto_enrol_error IS 'Last error from auto-enrol pipeline, format: "<step>: <reason>"';


--
-- Name: COLUMN da_application.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.da_application.user_id IS 'Linked app_user.id for the learner, resolved from trainee email/NRIC when available';


--
-- Name: developer_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.developer_profile (
    user_id uuid NOT NULL,
    tel text NOT NULL,
    developer_type public.developer_type NOT NULL,
    cv_url text,
    linkedin_url text,
    gender public.gender,
    qualifications jsonb DEFAULT '{}'::jsonb,
    education text DEFAULT '{}'::jsonb,
    areas_of_specialty jsonb DEFAULT '{}'::jsonb,
    cv_original_filename text,
    nric text,
    nationality text,
    ethnicity text,
    dob date,
    secondary_email text,
    cv_folder_url text,
    skills_tags jsonb DEFAULT '[]'::jsonb,
    certification_tags jsonb DEFAULT '[]'::jsonb
);


--
-- Name: enrollment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrollment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    course_id uuid NOT NULL,
    course_run_id uuid NOT NULL,
    progress_percent numeric(5,2) DEFAULT 0,
    payment_status public.learner_payment_status,
    assessment_status text DEFAULT 'Pending'::public.grade_status,
    course_sponsorship public.course_sponsorship,
    enrolment_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    certificate text,
    enrolment_id text,
    enrolment_status text,
    nric text,
    email text,
    course_reference text,
    training_partner_code text,
    completion_date timestamp with time zone,
    raw_data jsonb,
    pro_forma_url text,
    company_invoice_url text,
    personal_invoice_url text,
    receipt_url text,
    proforma_invoice_number text,
    personal_invoice_number text,
    company_invoice_number text,
    receipt_number text,
    calendar_added boolean DEFAULT false,
    grant_id text,
    grant_amount text,
    CONSTRAINT enrollment_progress_percent_check CHECK (((progress_percent >= (0)::numeric) AND (progress_percent <= (100)::numeric)))
);


--
-- Name: enrolment_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrolment_sync_log (
    id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    enrolment_id text,
    email text,
    full_name text,
    nric text,
    course_run_id text,
    course_reference text,
    enrolment_status text,
    sponsorship_type text,
    payment_status text,
    action text NOT NULL,
    account_action text NOT NULL,
    source text,
    error_message text
);


--
-- Name: enrolment_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.enrolment_sync_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: enrolment_sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.enrolment_sync_log_id_seq OWNED BY public.enrolment_sync_log.id;


--
-- Name: finance_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_profile (
    user_id uuid NOT NULL,
    tel text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: google_calendar_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_calendar_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    google_event_id text NOT NULL,
    event_date text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    stripped_title text DEFAULT ''::text NOT NULL,
    class_type text DEFAULT 'Physical'::text NOT NULL,
    day_number integer,
    start_time text DEFAULT ''::text NOT NULL,
    end_time text DEFAULT ''::text NOT NULL,
    location text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    hangout_link text DEFAULT ''::text NOT NULL,
    html_link text DEFAULT ''::text NOT NULL,
    event_status text DEFAULT ''::text NOT NULL,
    attendees jsonb DEFAULT '[]'::jsonb NOT NULL,
    attendee_count integer DEFAULT 0 NOT NULL,
    creator_email text DEFAULT ''::text NOT NULL,
    organizer_email text DEFAULT ''::text NOT NULL,
    raw_data jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grant_import_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grant_import_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    row_id uuid,
    event_type public.grant_import_audit_event_type NOT NULL,
    actor_user_id uuid,
    event_at timestamp with time zone DEFAULT now() NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: grant_import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grant_import_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    filename text,
    total_rows integer DEFAULT 0 NOT NULL,
    valid_rows integer DEFAULT 0 NOT NULL,
    ready_rows integer DEFAULT 0 NOT NULL,
    applied_rows integer DEFAULT 0 NOT NULL,
    failed_rows integer DEFAULT 0 NOT NULL,
    unmatched_rows integer DEFAULT 0 NOT NULL,
    ambiguous_rows integer DEFAULT 0 NOT NULL,
    already_applied_rows integer DEFAULT 0 NOT NULL,
    status public.grant_import_batch_status DEFAULT 'pending_review'::public.grant_import_batch_status NOT NULL,
    applied_at timestamp with time zone,
    applied_by uuid
);


--
-- Name: grant_import_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grant_import_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    row_number integer NOT NULL,
    financial_transaction_id text,
    enrolment_id text,
    grant_id text,
    course_title text,
    scheme text,
    trainee_id text,
    trainee_name text,
    employer_name text,
    amount_raw text,
    amount_parsed numeric(10,2),
    payment_date_raw text,
    payment_date_parsed date,
    bank_reference_id text,
    funding_component text,
    raw_row_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    validation_status public.grant_import_validation_status DEFAULT 'invalid'::public.grant_import_validation_status NOT NULL,
    validation_errors jsonb,
    match_status public.grant_import_match_status DEFAULT 'invalid'::public.grant_import_match_status NOT NULL,
    matched_fms_record_id text,
    matched_qb_object_id text,
    existing_amount numeric(10,2),
    existing_payment_date date,
    selected_for_apply boolean DEFAULT true NOT NULL,
    apply_status public.grant_import_apply_status,
    apply_error text,
    applied_at timestamp with time zone,
    matched_qb_invoice_id text,
    qb_payment_verified boolean,
    fms_qb_drift boolean,
    fms_was_applied boolean
);


--
-- Name: invoice_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id text,
    status text DEFAULT 'queued'::text NOT NULL,
    enrolment_id character varying(100) NOT NULL,
    user_id uuid NOT NULL,
    learner_email text NOT NULL,
    course_code text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    qbo_invoice_id character varying(100),
    qbo_doc_number character varying(100),
    drive_file_id text,
    drive_web_view_link text,
    last_attempt_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    invoice_no character varying(64),
    invoice_sent_at timestamp with time zone,
    invoice_sent_to text,
    qbo_sfc_status character varying,
    qbo_tg_status character varying,
    qbo_net_fee_status character varying,
    grn_doc_number text
);


--
-- Name: job_posting; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_posting (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    company text NOT NULL,
    location text NOT NULL,
    salary_min numeric(12,2) NOT NULL,
    salary_max numeric(12,2) NOT NULL,
    area text NOT NULL,
    description text NOT NULL,
    url text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_posting_check CHECK ((salary_max >= salary_min)),
    CONSTRAINT job_posting_salary_min_check CHECK ((salary_min >= (0)::numeric)),
    CONSTRAINT url_prefix CHECK ((("left"(url, 7) = 'http://'::text) OR ("left"(url, 8) = 'https://'::text)))
);


--
-- Name: learner_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learner_profile (
    user_id uuid NOT NULL,
    tel text,
    nric text,
    gender text,
    company text,
    employment_status public.employment_status,
    nationality public.nationality,
    ethnicity public.ethnicity,
    dob date,
    invoice_url text,
    receipt_url text,
    pro_forma_url text
);


--
-- Name: learning_unit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.learning_unit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    title text NOT NULL,
    "position" integer DEFAULT 1 NOT NULL
);


--
-- Name: link_assessment_submission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.link_assessment_submission (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    course_run_id uuid NOT NULL,
    assessment_type character varying(20) NOT NULL,
    file_name character varying(255) NOT NULL,
    file_url text NOT NULL,
    submitted_at timestamp with time zone DEFAULT now(),
    CONSTRAINT link_assessment_submission_assessment_type_check CHECK (((assessment_type)::text = ANY ((ARRAY['written'::character varying, 'practical'::character varying, 'writtenAssessment'::character varying, 'practicalExam'::character varying, 'caseStudy'::character varying, 'rolePlay'::character varying, 'oralQuestioning'::character varying, 'project'::character varying, 'assignment'::character varying])::text[])))
);


--
-- Name: masterlist_table; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.masterlist_table (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    class_id uuid NOT NULL,
    class_type text NOT NULL,
    list_date date,
    course_title text,
    trainer text,
    trainer_email text,
    name text,
    contact_no text,
    email text,
    magento_order_no text,
    virtual_reschedule text,
    comments text,
    entry_date text,
    "grant" text,
    invoice_no text,
    payment_mode text,
    course_fee text,
    nett_fee text,
    payment_status text,
    followup_by text,
    remark text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    qr_attendance text,
    zoom_id text,
    meeting_id text,
    schedule_entries jsonb DEFAULT '[]'::jsonb,
    course_run_no text,
    class_date text,
    venue text,
    notes text,
    cancelled boolean DEFAULT false,
    calendar_event_id text,
    invoice_no_color text,
    payment_mode_color text
);


--
-- Name: otp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    otp_code character varying(6) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: provider_admin_user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_admin_user (
    provider_id uuid NOT NULL,
    user_id uuid NOT NULL
);


--
-- Name: quiz_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_attempt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    course_id uuid NOT NULL,
    quiz_id text NOT NULL,
    score integer NOT NULL,
    total integer NOT NULL,
    answers jsonb NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE quiz_attempt; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.quiz_attempt IS 'Learner quiz attempts. Quiz definitions live on course.resource_links (JSONB); this table records one row per submission with the final score.';


--
-- Name: scheduler_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduler_config (
    id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    cron_expression text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    api_endpoint text NOT NULL,
    last_run_at timestamp with time zone,
    last_status text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    email_template text,
    days_in_advance integer DEFAULT 3
);


--
-- Name: search_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_log (
    id integer NOT NULL,
    search_term text NOT NULL,
    search_type text DEFAULT 'general'::text,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: search_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.search_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: search_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.search_log_id_seq OWNED BY public.search_log.id;


--
-- Name: sfc_import_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sfc_import_audit_logs (
    id integer NOT NULL,
    batch_id integer,
    row_id integer,
    event character varying NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sfc_import_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sfc_import_audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sfc_import_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sfc_import_audit_logs_id_seq OWNED BY public.sfc_import_audit_logs.id;


--
-- Name: sfc_import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sfc_import_batches (
    id integer NOT NULL,
    filename character varying NOT NULL,
    uploaded_by character varying,
    status character varying DEFAULT 'processing'::character varying NOT NULL,
    total_rows integer DEFAULT 0,
    ready_count integer DEFAULT 0,
    already_applied_count integer DEFAULT 0,
    unmatched_count integer DEFAULT 0,
    skipped_da_count integer DEFAULT 0,
    invalid_count integer DEFAULT 0,
    applied_count integer DEFAULT 0,
    skipped_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone
);


--
-- Name: sfc_import_batches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sfc_import_batches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sfc_import_batches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sfc_import_batches_id_seq OWNED BY public.sfc_import_batches.id;


--
-- Name: sfc_import_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sfc_import_rows (
    id integer NOT NULL,
    batch_id integer,
    row_index integer NOT NULL,
    claim_id character varying,
    individual_nric character varying,
    individual_name character varying,
    course_reference_number character varying,
    course_name character varying,
    course_start_date character varying,
    disbursement_date character varying,
    disbursement_date_iso character varying,
    claim_amount numeric(10,2),
    payout_request_id character varying,
    claim_status character varying,
    match_status character varying DEFAULT 'pending'::character varying NOT NULL,
    matched_enrolment_id character varying,
    matched_ssg_claim_id character varying,
    sponsorship_type character varying,
    matched_qbo_invoice_id character varying,
    matched_qbo_doc_number character varying,
    matched_qbo_invoice_balance numeric(10,2),
    matched_qb_payment_id character varying,
    validation_errors jsonb DEFAULT '[]'::jsonb,
    apply_status character varying,
    apply_error character varying,
    applied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    da_application_id character varying,
    da_sfc_invoice_id character varying,
    main_qbo_invoice_id character varying,
    main_qbo_doc_number character varying
);


--
-- Name: sfc_import_rows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sfc_import_rows_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sfc_import_rows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sfc_import_rows_id_seq OWNED BY public.sfc_import_rows.id;


--
-- Name: ssg_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ssg_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_id character varying(100),
    grant_id character varying(100),
    enrollment_id character varying(100),
    trainee_name character varying(255),
    course_reference character varying(100),
    training_partner_code character varying(50),
    claim_status character varying(50),
    claim_amount numeric(10,2),
    submission_date timestamp with time zone,
    approval_date timestamp with time zone,
    payment_date timestamp with time zone,
    created_date timestamp with time zone DEFAULT now() NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_data jsonb,
    course_name text,
    course_start_date timestamp with time zone,
    disbursement_date timestamp with time zone,
    ready_for_payout_date timestamp with time zone,
    payout_request_id bigint,
    paynow_account character varying(100),
    individual_nric character varying(50),
    sctp_declaration character varying(50),
    lapsed_date timestamp with time zone,
    claim_payment_status character varying DEFAULT 'NOT_RECEIVED'::character varying,
    qb_payment_id character varying,
    last_sfc_import_at timestamp with time zone
);


--
-- Name: ssg_course_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ssg_course_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_run_id text NOT NULL,
    reference_number text,
    sequence_number integer,
    mode_of_training text,
    course_admin_email text,
    course_dates jsonb,
    registration_dates jsonb,
    course_vacancy jsonb,
    venue jsonb,
    link_course_run_trainer jsonb,
    intake_size integer,
    threshold integer,
    registered_user_count integer,
    attendance_taken boolean,
    qr_code_link text,
    schedule_info text,
    schedule_info_type jsonb,
    organization_key text,
    raw_data jsonb,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    course_title text,
    ra_code text
);


--
-- Name: ssg_enrolment_record; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ssg_enrolment_record (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrolment_reference text NOT NULL,
    enrolment_date date,
    learner_name text,
    learner_nric text,
    learner_email text,
    course_title text,
    course_ref_code text,
    course_run_id text,
    start_date date,
    status text,
    raw_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ssg_enrolments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ssg_enrolments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrolment_id character varying(100),
    trainee_name character varying(255),
    trainee_nric character varying(20),
    course_title character varying(255),
    course_reference character varying(100),
    course_run_id character varying(100),
    training_partner_code character varying(50),
    enrolment_status character varying(50),
    sponsorship_type character varying(50),
    enrolment_date timestamp with time zone,
    completion_date timestamp with time zone,
    created_date timestamp with time zone DEFAULT now() NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_data jsonb,
    total_grant_expected numeric(10,2),
    total_grant_received numeric(10,2) DEFAULT 0 NOT NULL,
    total_grant_pending numeric(10,2),
    grant_payment_status public.grant_payment_status,
    last_grant_import_at timestamp with time zone,
    personal_data_masked boolean DEFAULT false NOT NULL
);


--
-- Name: ssg_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ssg_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id character varying(100),
    grant_id character varying(100),
    status character varying(50),
    funding_scheme_code character varying(50),
    funding_scheme_description character varying(255),
    component_code character varying(50),
    component_description character varying(255),
    estimated_grant_amount numeric(10,2),
    approved_grant_amount numeric(10,2),
    created_date timestamp with time zone DEFAULT now() NOT NULL,
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    api_response jsonb,
    payment_received boolean,
    payment_date date,
    payment_bank_ref text,
    payment_qb_payment_id text
);


--
-- Name: submission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.submission (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    file_name text NOT NULL,
    submitted_at timestamp with time zone NOT NULL,
    file_url text,
    grading text
);


--
-- Name: subtopic; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtopic (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learning_unit_id uuid NOT NULL,
    title text NOT NULL,
    "position" integer DEFAULT 1 NOT NULL
);


--
-- Name: subtopic_completion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtopic_completion (
    user_id uuid NOT NULL,
    course_run_id uuid NOT NULL,
    subtopic_id uuid NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: support_ticket; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_ticket (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_number text NOT NULL,
    user_id uuid NOT NULL,
    subject text NOT NULL,
    description text NOT NULL,
    category text DEFAULT 'General'::text NOT NULL,
    status text DEFAULT 'Open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: support_ticket_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_ticket_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_ticket_reply; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_ticket_reply (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    user_id uuid NOT NULL,
    user_role text NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sync_trainer_tpg_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_trainer_tpg_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    course_run_id text,
    course_run_uuid text,
    course_code text,
    course_ref_number text,
    trainer_name text,
    trainer_email text,
    nric_present boolean DEFAULT false NOT NULL,
    nric_masked text,
    ssg_status integer,
    ssg_response text,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text
);


--
-- Name: sync_trainer_tpg_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_trainer_tpg_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_trainer_tpg_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_trainer_tpg_log_id_seq OWNED BY public.sync_trainer_tpg_log.id;


--
-- Name: topic_completion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topic_completion (
    user_id uuid NOT NULL,
    course_run_id uuid NOT NULL,
    topic_id uuid NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trainer_assessment_grading; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_assessment_grading (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_run_id uuid NOT NULL,
    learner_user_id uuid NOT NULL,
    grade character varying(3) NOT NULL,
    reason text DEFAULT ''::text,
    graded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT trainer_assessment_grading_grade_check CHECK (((grade)::text = ANY ((ARRAY['C'::character varying, 'NYC'::character varying])::text[])))
);


--
-- Name: trainer_invitation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_invitation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_run_id uuid NOT NULL,
    trainer_name text NOT NULL,
    trainer_email text NOT NULL,
    token text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    email_subject text,
    email_body text,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trainer_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_profile (
    user_id uuid NOT NULL,
    tel text NOT NULL,
    gender public.gender NOT NULL,
    trainer_type public.trainer_type NOT NULL,
    status public.trainer_status NOT NULL,
    linkedin_url text,
    cv_url text,
    qualifications jsonb DEFAULT '{}'::jsonb,
    education text,
    areas_of_expertise jsonb DEFAULT '{}'::jsonb,
    cv_original_filename text,
    common_name text,
    country text,
    cn_plus_email text,
    nric text,
    nationality text,
    ethnicity text,
    dob date,
    cv_folder_url text,
    skills_tags jsonb DEFAULT '[]'::jsonb,
    certification_tags jsonb DEFAULT '[]'::jsonb
);


--
-- Name: COLUMN trainer_profile.common_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trainer_profile.common_name IS 'Preferred / common name of the trainer';


--
-- Name: COLUMN trainer_profile.country; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trainer_profile.country IS 'Country of the trainer';


--
-- Name: COLUMN trainer_profile.cn_plus_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trainer_profile.cn_plus_email IS 'CN Plus email address of the trainer';


--
-- Name: COLUMN trainer_profile.nric; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.trainer_profile.nric IS 'NRIC of the trainer';


--
-- Name: training_provider; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_provider (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text,
    company_shortname text,
    uen text,
    company_address text,
    contact_person_name text,
    contact_tel text,
    pro_forma_template_url text,
    invoice_template_url text,
    receipt_template_url text,
    certificate_template_url text,
    ssg_self_sign_cert_file text,
    ssg_private_key_file text,
    ssg_encryption_key text,
    color_scheme text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sync_google_calendar boolean DEFAULT false NOT NULL,
    sync_ms_calendar boolean DEFAULT false NOT NULL,
    integrate_google_drive boolean DEFAULT false NOT NULL,
    integrate_ms_onedrive boolean DEFAULT false NOT NULL,
    auto_send_proforma_invoice boolean DEFAULT false NOT NULL,
    auto_send_confirm_email boolean DEFAULT false NOT NULL,
    auto_send_invoice boolean DEFAULT false NOT NULL,
    auto_send_receipt boolean DEFAULT false NOT NULL,
    auto_send_certificate boolean DEFAULT false NOT NULL,
    auto_send_thankyou_email boolean DEFAULT false NOT NULL,
    auto_mask_sensitive_data boolean DEFAULT false NOT NULL,
    auto_delete_after_six_months boolean DEFAULT false NOT NULL,
    enable_otp_login boolean DEFAULT false NOT NULL,
    enable_default_otp boolean DEFAULT false NOT NULL,
    default_otp text,
    enable_leaderboard boolean DEFAULT false NOT NULL,
    enable_point_sys boolean DEFAULT false NOT NULL,
    normal_fund_rate numeric,
    enhanced_fund_rate numeric,
    gst_rate numeric,
    gst_register boolean DEFAULT false NOT NULL,
    company_logo_url text,
    force_first_password_change boolean DEFAULT false NOT NULL,
    default_password text,
    google_calendar_url text,
    ms_calendar_url text,
    email_user text,
    google_client_id text,
    google_client_secret text,
    google_refresh_token text,
    google_slides_template_id text,
    certificate_folder_url text,
    master_list_url text,
    tertiary_tms_url text,
    tertiary_fms_url text,
    tertiary_mms_url text,
    tertiary_tpms_url text,
    n8n_host1_url text,
    n8n_host2_url text,
    magento_backend_url text,
    privacy_policy text,
    acceptable_use_policy text,
    otp_email_subject text,
    otp_email_body text,
    ssg_cert_pem text,
    ssg_key_pem text,
    ssg_api_base_url text DEFAULT 'https://api.ssg-wsg.sg'::text,
    company_email text,
    company_tel text,
    company_website text,
    certificate_email_subject text,
    certificate_email_body text,
    certificate_email_cc text,
    feedback_email_subject text,
    feedback_email_body text,
    feedback_email_cc text,
    support_email text,
    openclaw_gateway_url text,
    openclaw_hooks_path text,
    openclaw_agent_id text,
    openclaw_callback_url text,
    openclaw_mode text,
    openclaw_local_gateway_url text,
    trainer_profile_image_url text,
    trainer_invitation_email_subject text,
    trainer_invitation_email_body text,
    upcoming_classes_threshold_days text,
    ssg_app1_cert_file text,
    ssg_app1_private_key_file text,
    ssg_app1_encryption_key text,
    ssg_app3_cert_file text,
    ssg_app3_private_key_file text,
    ssg_app3_encryption_key text,
    ssg_app4_client_id text,
    ssg_app4_client_secret text,
    ssg_default_app text DEFAULT 'app2'::text,
    ssg_app_count smallint DEFAULT 1 NOT NULL,
    ssg_app_names jsonb DEFAULT '{}'::jsonb NOT NULL,
    virtual_meeting_provider text DEFAULT 'google_meet'::text,
    app1_cert_expiry timestamp with time zone,
    app2_cert_expiry timestamp with time zone,
    app3_cert_expiry timestamp with time zone,
    app4_secret_last_generated_at timestamp with time zone,
    final_course_confirmation_email_subject text,
    final_course_confirmation_email_body text,
    course_confirmation_email_subject text,
    course_confirmation_email_body text,
    course_confirmation_email_cc text,
    final_course_confirmation_email_cc text,
    n8n_finance_webhooks_json text,
    trainer_accept_email_subject text,
    trainer_accept_email_body text,
    trainer_decline_email_subject text,
    trainer_decline_email_body text,
    courseware_attendance_email_subject text,
    courseware_attendance_email_body text,
    courseware_attendance_email_cc text,
    auto_enrol_direct_applications boolean DEFAULT false NOT NULL,
    auto_generate_qb_invoice boolean DEFAULT false NOT NULL,
    trainer_invitation_email_cc text,
    trainer_accept_email_cc text,
    trainer_decline_email_cc text,
    sanitise_after_months integer DEFAULT 6 NOT NULL,
    proforma_invoice_email_subject text,
    proforma_invoice_email_body text,
    proforma_invoice_email_cc text,
    proforma_invoice_email_attachment_url text,
    auto_add_learner_to_calendar boolean DEFAULT false,
    google_service_account_json text,
    certificate_attendance_threshold text,
    cas_threshold text,
    es_threshold text,
    course_completion_email_subject text,
    course_completion_email_body text,
    course_completion_email_cc text,
    auto_send_invoice_email boolean DEFAULT false,
    gst_registration_number text,
    da_invoice_email_cc text,
    da_invoice_email_bcc text,
    show_lesson_plan_learner_view boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN training_provider.final_course_confirmation_email_subject; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.final_course_confirmation_email_subject IS 'final_course_confirmation_email_subject for 3 days';


--
-- Name: COLUMN training_provider.final_course_confirmation_email_body; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.final_course_confirmation_email_body IS 'final_course_confirmation_email_body for 3 days';


--
-- Name: COLUMN training_provider.course_confirmation_email_subject; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.course_confirmation_email_subject IS 'course_confirmation_email_subject for 7 days';


--
-- Name: COLUMN training_provider.course_confirmation_email_body; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.course_confirmation_email_body IS 'course_confirmation_email_body for 7 days';


--
-- Name: COLUMN training_provider.course_confirmation_email_cc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.course_confirmation_email_cc IS 'course_confirmation_email_cc for 7 days';


--
-- Name: COLUMN training_provider.auto_enrol_direct_applications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.auto_enrol_direct_applications IS 'Master toggle: auto-submit direct applications to SSG after Excel upload';


--
-- Name: COLUMN training_provider.auto_generate_qb_invoice; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.auto_generate_qb_invoice IS 'Secondary toggle: auto-create QuickBooks invoice after successful SSG enrolment (requires auto_enrol_direct_applications = true)';


--
-- Name: COLUMN training_provider.trainer_invitation_email_cc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.trainer_invitation_email_cc IS 'Comma-separated CC list for trainer invitation emails.';


--
-- Name: COLUMN training_provider.trainer_accept_email_cc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.trainer_accept_email_cc IS 'Comma-separated CC list for trainer accept confirmation emails.';


--
-- Name: COLUMN training_provider.trainer_decline_email_cc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.trainer_decline_email_cc IS 'Comma-separated CC list for trainer decline acknowledgement emails.';


--
-- Name: COLUMN training_provider.sanitise_after_months; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.sanitise_after_months IS 'Retention window for the Auto Sanitise Data sweep. Rows older than this many months get NRIC + phone redacted in place. Default 6.';


--
-- Name: COLUMN training_provider.auto_send_invoice_email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.training_provider.auto_send_invoice_email IS 'Master toggle for emailing the main tax invoice to learners after Direct Application invoice generation. Defaults to false for safe testing.';


--
-- Name: training_provider_api; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_provider_api (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    training_provider_id uuid NOT NULL,
    key_name text NOT NULL,
    key_value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    selected_model text
);


--
-- Name: training_provider_member; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_provider_member (
    provider_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE training_provider_member; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.training_provider_member IS 'Links users with Training Provider role to their training provider organization. Each user sees their own company profile.';


--
-- Name: upcoming_course_runs_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.upcoming_course_runs_log (
    id integer NOT NULL,
    run_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    course_run_id text,
    course_title text,
    course_code text,
    db_start_date text,
    db_end_date text,
    ssg_start_date text,
    ssg_end_date text,
    mode_of_learning text,
    vacancy_code text,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text
);


--
-- Name: upcoming_course_runs_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.upcoming_course_runs_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: upcoming_course_runs_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.upcoming_course_runs_log_id_seq OWNED BY public.upcoming_course_runs_log.id;


--
-- Name: user_role_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_role_map (
    user_id uuid NOT NULL,
    role public.user_role NOT NULL
);


--
-- Name: user_saved_job; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_saved_job (
    user_id uuid NOT NULL,
    job_posting_id uuid NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_subtopic_bookmark; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_subtopic_bookmark (
    user_id uuid NOT NULL,
    subtopic_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    course_run_id uuid NOT NULL
);


--
-- Name: webhook_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_logs (
    id integer NOT NULL,
    webhook_id uuid NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    http_method text NOT NULL,
    headers jsonb,
    query_params jsonb,
    body jsonb,
    source_ip text,
    status_code integer DEFAULT 200 NOT NULL,
    response_body jsonb,
    error_message text
);


--
-- Name: webhook_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhook_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_logs_id_seq OWNED BY public.webhook_logs.id;


--
-- Name: webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    http_method text DEFAULT 'POST'::text NOT NULL,
    endpoint_token text NOT NULL,
    auth_token text,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT webhooks_http_method_check CHECK ((http_method = ANY (ARRAY['GET'::text, 'POST'::text])))
);


--
-- Name: work_experience; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_experience (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trainer_id uuid,
    company text NOT NULL,
    job_title text NOT NULL,
    start_date date NOT NULL,
    end_date date,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    developer_id uuid,
    CONSTRAINT work_experience_owner_check CHECK ((((trainer_id IS NOT NULL) AND (developer_id IS NULL)) OR ((trainer_id IS NULL) AND (developer_id IS NOT NULL))))
);


--
-- Name: api_subscription id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_subscription ALTER COLUMN id SET DEFAULT nextval('public.api_subscription_id_seq'::regclass);


--
-- Name: auto_create_assessment_record_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_create_assessment_record_log ALTER COLUMN id SET DEFAULT nextval('public.auto_create_assessment_record_log_id_seq'::regclass);


--
-- Name: auto_create_certificates_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_create_certificates_log ALTER COLUMN id SET DEFAULT nextval('public.auto_create_certificates_log_id_seq'::regclass);


--
-- Name: auto_create_learner_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_create_learner_log ALTER COLUMN id SET DEFAULT nextval('public.auto_create_learner_log_id_seq'::regclass);


--
-- Name: auto_create_trainer_folder_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_create_trainer_folder_log ALTER COLUMN id SET DEFAULT nextval('public.auto_create_trainer_folder_log_id_seq'::regclass);


--
-- Name: auto_generate_da_invoices_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_generate_da_invoices_log ALTER COLUMN id SET DEFAULT nextval('public.auto_generate_da_invoices_log_id_seq'::regclass);


--
-- Name: auto_generate_proforma_invoices_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_generate_proforma_invoices_log ALTER COLUMN id SET DEFAULT nextval('public.auto_generate_proforma_invoices_log_id_seq'::regclass);


--
-- Name: auto_sanitise_data_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_sanitise_data_log ALTER COLUMN id SET DEFAULT nextval('public.auto_sanitise_data_log_id_seq'::regclass);


--
-- Name: auto_send_confirmation_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_send_confirmation_log ALTER COLUMN id SET DEFAULT nextval('public.auto_send_confirmation_log_id_seq'::regclass);


--
-- Name: auto_send_course_completion_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_send_course_completion_log ALTER COLUMN id SET DEFAULT nextval('public.auto_send_course_completion_log_id_seq'::regclass);


--
-- Name: auto_send_courseware_attendance_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_send_courseware_attendance_log ALTER COLUMN id SET DEFAULT nextval('public.auto_send_courseware_attendance_log_id_seq'::regclass);


--
-- Name: auto_send_trainer_invitation_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_send_trainer_invitation_log ALTER COLUMN id SET DEFAULT nextval('public.auto_send_trainer_invitation_log_id_seq'::regclass);


--
-- Name: calendar_event id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_event ALTER COLUMN id SET DEFAULT nextval('public.calendar_event_id_seq'::regclass);


--
-- Name: course_run_date_sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run_date_sync_log ALTER COLUMN id SET DEFAULT nextval('public.course_run_date_sync_log_id_seq'::regclass);


--
-- Name: course_session_timing id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_session_timing ALTER COLUMN id SET DEFAULT nextval('public.course_session_timing_id_seq'::regclass);


--
-- Name: enrolment_sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrolment_sync_log ALTER COLUMN id SET DEFAULT nextval('public.enrolment_sync_log_id_seq'::regclass);


--
-- Name: search_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_log ALTER COLUMN id SET DEFAULT nextval('public.search_log_id_seq'::regclass);


--
-- Name: sfc_import_audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfc_import_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.sfc_import_audit_logs_id_seq'::regclass);


--
-- Name: sfc_import_batches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfc_import_batches ALTER COLUMN id SET DEFAULT nextval('public.sfc_import_batches_id_seq'::regclass);


--
-- Name: sfc_import_rows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfc_import_rows ALTER COLUMN id SET DEFAULT nextval('public.sfc_import_rows_id_seq'::regclass);


--
-- Name: sync_trainer_tpg_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_trainer_tpg_log ALTER COLUMN id SET DEFAULT nextval('public.sync_trainer_tpg_log_id_seq'::regclass);


--
-- Name: upcoming_course_runs_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upcoming_course_runs_log ALTER COLUMN id SET DEFAULT nextval('public.upcoming_course_runs_log_id_seq'::regclass);


--
-- Name: webhook_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_logs ALTER COLUMN id SET DEFAULT nextval('public.webhook_logs_id_seq'::regclass);


--
-- Name: admin_profile admin_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_profile
    ADD CONSTRAINT admin_profile_pkey PRIMARY KEY (user_id);


--
-- Name: api_subscription api_subscription_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_subscription
    ADD CONSTRAINT api_subscription_pkey PRIMARY KEY (id);


--
-- Name: app_config app_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);


--
-- Name: app_user app_user_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_email_key UNIQUE (email);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (id);


--
-- Name: app_user app_user_supabase_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_supabase_user_id_unique UNIQUE (supabase_user_id);


--
-- Name: assessment_grade assessment_grade_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_grade
    ADD CONSTRAINT assessment_grade_pkey PRIMARY KEY (enrollment_id, assessment_id);


--
-- Name: assessment assessment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment
    ADD CONSTRAINT assessment_pkey PRIMARY KEY (id);


--
-- Name: auto_create_assessment_record_log auto_create_assessment_record_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_create_assessment_record_log
    ADD CONSTRAINT auto_create_assessment_record_log_pkey PRIMARY KEY (id);


--
-- Name: auto_create_certificates_log auto_create_certificates_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_create_certificates_log
    ADD CONSTRAINT auto_create_certificates_log_pkey PRIMARY KEY (id);


--
-- Name: auto_create_learner_log auto_create_learner_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_create_learner_log
    ADD CONSTRAINT auto_create_learner_log_pkey PRIMARY KEY (id);


--
-- Name: auto_create_trainer_folder_log auto_create_trainer_folder_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_create_trainer_folder_log
    ADD CONSTRAINT auto_create_trainer_folder_log_pkey PRIMARY KEY (id);


--
-- Name: auto_generate_da_invoices_log auto_generate_da_invoices_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_generate_da_invoices_log
    ADD CONSTRAINT auto_generate_da_invoices_log_pkey PRIMARY KEY (id);


--
-- Name: auto_generate_proforma_invoices_log auto_generate_proforma_invoices_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_generate_proforma_invoices_log
    ADD CONSTRAINT auto_generate_proforma_invoices_log_pkey PRIMARY KEY (id);


--
-- Name: auto_sanitise_data_log auto_sanitise_data_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_sanitise_data_log
    ADD CONSTRAINT auto_sanitise_data_log_pkey PRIMARY KEY (id);


--
-- Name: auto_send_confirmation_log auto_send_confirmation_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_send_confirmation_log
    ADD CONSTRAINT auto_send_confirmation_log_pkey PRIMARY KEY (id);


--
-- Name: auto_send_course_completion_log auto_send_course_completion_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_send_course_completion_log
    ADD CONSTRAINT auto_send_course_completion_log_pkey PRIMARY KEY (id);


--
-- Name: auto_send_courseware_attendance_log auto_send_courseware_attendance_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_send_courseware_attendance_log
    ADD CONSTRAINT auto_send_courseware_attendance_log_pkey PRIMARY KEY (id);


--
-- Name: auto_send_trainer_invitation_log auto_send_trainer_invitation_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_send_trainer_invitation_log
    ADD CONSTRAINT auto_send_trainer_invitation_log_pkey PRIMARY KEY (id);


--
-- Name: calendar_event calendar_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_event
    ADD CONSTRAINT calendar_event_pkey PRIMARY KEY (id);


--
-- Name: chat_conversation chat_conversation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversation
    ADD CONSTRAINT chat_conversation_pkey PRIMARY KEY (id);


--
-- Name: chat_message chat_message_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message
    ADD CONSTRAINT chat_message_pkey PRIMARY KEY (id);


--
-- Name: company_application company_application_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_application
    ADD CONSTRAINT company_application_application_id_key UNIQUE (application_id);


--
-- Name: company_application company_application_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_application
    ADD CONSTRAINT company_application_pkey PRIMARY KEY (id);


--
-- Name: company_invoice_batch company_invoice_batch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_invoice_batch
    ADD CONSTRAINT company_invoice_batch_pkey PRIMARY KEY (id);


--
-- Name: course_announcement course_announcement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_announcement
    ADD CONSTRAINT course_announcement_pkey PRIMARY KEY (id);


--
-- Name: course_attendance course_attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_attendance
    ADD CONSTRAINT course_attendance_pkey PRIMARY KEY (id);


--
-- Name: course_attendance course_attendance_session_id_nric_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_attendance
    ADD CONSTRAINT course_attendance_session_id_nric_key UNIQUE (session_id, nric);


--
-- Name: course course_course_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_course_code_key UNIQUE (course_code);


--
-- Name: course course_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_pkey PRIMARY KEY (id);


--
-- Name: course_run_assessment course_run_assessment_course_run_id_assessment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run_assessment
    ADD CONSTRAINT course_run_assessment_course_run_id_assessment_id_key UNIQUE (course_run_id, assessment_id);


--
-- Name: course_run_assessment course_run_assessment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run_assessment
    ADD CONSTRAINT course_run_assessment_pkey PRIMARY KEY (id);


--
-- Name: course_run_date_sync_log course_run_date_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run_date_sync_log
    ADD CONSTRAINT course_run_date_sync_log_pkey PRIMARY KEY (id);


--
-- Name: course_run course_run_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run
    ADD CONSTRAINT course_run_pkey PRIMARY KEY (id);


--
-- Name: course_run_trainer course_run_trainer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run_trainer
    ADD CONSTRAINT course_run_trainer_pkey PRIMARY KEY (id);


--
-- Name: course_session course_session_course_run_id_ssg_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_session
    ADD CONSTRAINT course_session_course_run_id_ssg_session_id_key UNIQUE (course_run_id, ssg_session_id);


--
-- Name: course_session course_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_session
    ADD CONSTRAINT course_session_pkey PRIMARY KEY (id);


--
-- Name: course_session_timing course_session_timing_course_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_session_timing
    ADD CONSTRAINT course_session_timing_course_code_key UNIQUE (course_code);


--
-- Name: course_session_timing course_session_timing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_session_timing
    ADD CONSTRAINT course_session_timing_pkey PRIMARY KEY (id);


--
-- Name: cp_prompt_template cp_prompt_template_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cp_prompt_template
    ADD CONSTRAINT cp_prompt_template_pkey PRIMARY KEY (section);


--
-- Name: da_application da_application_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.da_application
    ADD CONSTRAINT da_application_pkey PRIMARY KEY (id);


--
-- Name: da_application da_application_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.da_application
    ADD CONSTRAINT da_application_unique UNIQUE (application_id);


--
-- Name: developer_profile developer_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.developer_profile
    ADD CONSTRAINT developer_profile_pkey PRIMARY KEY (user_id);


--
-- Name: enrollment enrollment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollment
    ADD CONSTRAINT enrollment_pkey PRIMARY KEY (id);


--
-- Name: enrollment enrollment_user_id_course_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollment
    ADD CONSTRAINT enrollment_user_id_course_run_id_key UNIQUE (user_id, course_run_id);


--
-- Name: enrolment_sync_log enrolment_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrolment_sync_log
    ADD CONSTRAINT enrolment_sync_log_pkey PRIMARY KEY (id);


--
-- Name: finance_profile finance_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_profile
    ADD CONSTRAINT finance_profile_pkey PRIMARY KEY (user_id);


--
-- Name: google_calendar_event google_calendar_event_google_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_event
    ADD CONSTRAINT google_calendar_event_google_event_id_key UNIQUE (google_event_id);


--
-- Name: google_calendar_event google_calendar_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_calendar_event
    ADD CONSTRAINT google_calendar_event_pkey PRIMARY KEY (id);


--
-- Name: grant_import_audit_logs grant_import_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_import_audit_logs
    ADD CONSTRAINT grant_import_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: grant_import_batches grant_import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_import_batches
    ADD CONSTRAINT grant_import_batches_pkey PRIMARY KEY (id);


--
-- Name: grant_import_rows grant_import_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_import_rows
    ADD CONSTRAINT grant_import_rows_pkey PRIMARY KEY (id);


--
-- Name: invoice_jobs invoice_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_jobs
    ADD CONSTRAINT invoice_jobs_pkey PRIMARY KEY (id);


--
-- Name: job_posting job_posting_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_posting
    ADD CONSTRAINT job_posting_pkey PRIMARY KEY (id);


--
-- Name: learner_profile learner_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_profile
    ADD CONSTRAINT learner_profile_pkey PRIMARY KEY (user_id);


--
-- Name: learning_unit learning_unit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_unit
    ADD CONSTRAINT learning_unit_pkey PRIMARY KEY (id);


--
-- Name: link_assessment_submission link_assessment_submission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.link_assessment_submission
    ADD CONSTRAINT link_assessment_submission_pkey PRIMARY KEY (id);


--
-- Name: masterlist_table masterlist_table_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.masterlist_table
    ADD CONSTRAINT masterlist_table_pkey PRIMARY KEY (id);


--
-- Name: otp_codes otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_codes
    ADD CONSTRAINT otp_codes_pkey PRIMARY KEY (id);


--
-- Name: provider_admin_user provider_admin_user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_admin_user
    ADD CONSTRAINT provider_admin_user_pkey PRIMARY KEY (provider_id, user_id);


--
-- Name: quiz_attempt quiz_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_pkey PRIMARY KEY (id);


--
-- Name: scheduler_config scheduler_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduler_config
    ADD CONSTRAINT scheduler_config_pkey PRIMARY KEY (id);


--
-- Name: search_log search_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_log
    ADD CONSTRAINT search_log_pkey PRIMARY KEY (id);


--
-- Name: sfc_import_audit_logs sfc_import_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfc_import_audit_logs
    ADD CONSTRAINT sfc_import_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: sfc_import_batches sfc_import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfc_import_batches
    ADD CONSTRAINT sfc_import_batches_pkey PRIMARY KEY (id);


--
-- Name: sfc_import_rows sfc_import_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfc_import_rows
    ADD CONSTRAINT sfc_import_rows_pkey PRIMARY KEY (id);


--
-- Name: ssg_claims ssg_claims_claim_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssg_claims
    ADD CONSTRAINT ssg_claims_claim_id_key UNIQUE (claim_id);


--
-- Name: ssg_claims ssg_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssg_claims
    ADD CONSTRAINT ssg_claims_pkey PRIMARY KEY (id);


--
-- Name: ssg_course_runs ssg_course_runs_course_run_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssg_course_runs
    ADD CONSTRAINT ssg_course_runs_course_run_id_key UNIQUE (course_run_id);


--
-- Name: ssg_course_runs ssg_course_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssg_course_runs
    ADD CONSTRAINT ssg_course_runs_pkey PRIMARY KEY (id);


--
-- Name: ssg_enrolment_record ssg_enrolment_record_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssg_enrolment_record
    ADD CONSTRAINT ssg_enrolment_record_pkey PRIMARY KEY (id);


--
-- Name: ssg_enrolments ssg_enrolments_enrolment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssg_enrolments
    ADD CONSTRAINT ssg_enrolments_enrolment_id_key UNIQUE (enrolment_id);


--
-- Name: ssg_enrolments ssg_enrolments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssg_enrolments
    ADD CONSTRAINT ssg_enrolments_pkey PRIMARY KEY (id);


--
-- Name: ssg_grants ssg_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssg_grants
    ADD CONSTRAINT ssg_grants_pkey PRIMARY KEY (id);


--
-- Name: ssg_grants ssg_grants_reference_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ssg_grants
    ADD CONSTRAINT ssg_grants_reference_number_key UNIQUE (grant_id);


--
-- Name: submission submission_enrollment_assessment_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission
    ADD CONSTRAINT submission_enrollment_assessment_unique UNIQUE (enrollment_id, assessment_id);


--
-- Name: submission submission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission
    ADD CONSTRAINT submission_pkey PRIMARY KEY (id);


--
-- Name: subtopic_completion subtopic_completion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtopic_completion
    ADD CONSTRAINT subtopic_completion_pkey PRIMARY KEY (user_id, course_run_id, subtopic_id);


--
-- Name: subtopic subtopic_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtopic
    ADD CONSTRAINT subtopic_pkey PRIMARY KEY (id);


--
-- Name: support_ticket support_ticket_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket
    ADD CONSTRAINT support_ticket_pkey PRIMARY KEY (id);


--
-- Name: support_ticket_reply support_ticket_reply_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_reply
    ADD CONSTRAINT support_ticket_reply_pkey PRIMARY KEY (id);


--
-- Name: support_ticket support_ticket_ticket_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket
    ADD CONSTRAINT support_ticket_ticket_number_key UNIQUE (ticket_number);


--
-- Name: sync_trainer_tpg_log sync_trainer_tpg_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_trainer_tpg_log
    ADD CONSTRAINT sync_trainer_tpg_log_pkey PRIMARY KEY (id);


--
-- Name: topic_completion topic_completion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topic_completion
    ADD CONSTRAINT topic_completion_pkey PRIMARY KEY (user_id, course_run_id, topic_id);


--
-- Name: trainer_assessment_grading trainer_assessment_grading_course_run_id_learner_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_assessment_grading
    ADD CONSTRAINT trainer_assessment_grading_course_run_id_learner_user_id_key UNIQUE (course_run_id, learner_user_id);


--
-- Name: trainer_assessment_grading trainer_assessment_grading_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_assessment_grading
    ADD CONSTRAINT trainer_assessment_grading_pkey PRIMARY KEY (id);


--
-- Name: certification trainer_certification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certification
    ADD CONSTRAINT trainer_certification_pkey PRIMARY KEY (id);


--
-- Name: trainer_invitation trainer_invitation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_invitation
    ADD CONSTRAINT trainer_invitation_pkey PRIMARY KEY (id);


--
-- Name: trainer_invitation trainer_invitation_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_invitation
    ADD CONSTRAINT trainer_invitation_token_key UNIQUE (token);


--
-- Name: trainer_profile trainer_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_profile
    ADD CONSTRAINT trainer_profile_pkey PRIMARY KEY (user_id);


--
-- Name: work_experience trainer_work_experience_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_experience
    ADD CONSTRAINT trainer_work_experience_pkey PRIMARY KEY (id);


--
-- Name: training_provider_api training_provider_api_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_provider_api
    ADD CONSTRAINT training_provider_api_pkey PRIMARY KEY (id);


--
-- Name: training_provider_member training_provider_member_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_provider_member
    ADD CONSTRAINT training_provider_member_pkey PRIMARY KEY (provider_id, user_id);


--
-- Name: training_provider training_provider_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_provider
    ADD CONSTRAINT training_provider_pkey PRIMARY KEY (id);


--
-- Name: upcoming_course_runs_log upcoming_course_runs_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.upcoming_course_runs_log
    ADD CONSTRAINT upcoming_course_runs_log_pkey PRIMARY KEY (id);


--
-- Name: course_run uq_course_run_per_course; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run
    ADD CONSTRAINT uq_course_run_per_course UNIQUE (course_id, course_run_id);


--
-- Name: submission uq_submission; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission
    ADD CONSTRAINT uq_submission UNIQUE (enrollment_id, assessment_id);


--
-- Name: user_role_map user_role_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_map
    ADD CONSTRAINT user_role_map_pkey PRIMARY KEY (user_id, role);


--
-- Name: user_saved_job user_saved_job_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_job
    ADD CONSTRAINT user_saved_job_pkey PRIMARY KEY (user_id, job_posting_id);


--
-- Name: user_subtopic_bookmark user_subtopic_bookmark_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subtopic_bookmark
    ADD CONSTRAINT user_subtopic_bookmark_pkey PRIMARY KEY (user_id, subtopic_id, course_run_id);


--
-- Name: webhook_logs webhook_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_logs
    ADD CONSTRAINT webhook_logs_pkey PRIMARY KEY (id);


--
-- Name: webhooks webhooks_endpoint_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_endpoint_token_key UNIQUE (endpoint_token);


--
-- Name: webhooks webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);


--
-- Name: grant_import_rows_batch_row_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX grant_import_rows_batch_row_number_unique ON public.grant_import_rows USING btree (batch_id, row_number);


--
-- Name: idx_app_user_auth_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_user_auth_provider ON public.app_user USING btree (auth_provider);


--
-- Name: idx_app_user_oauth_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_user_oauth_provider_id ON public.app_user USING btree (oauth_provider, oauth_provider_id);


--
-- Name: idx_app_user_supabase_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_user_supabase_user_id ON public.app_user USING btree (supabase_user_id);


--
-- Name: idx_auto_generate_da_invoices_log_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_generate_da_invoices_log_run ON public.auto_generate_da_invoices_log USING btree (run_id, created_at DESC);


--
-- Name: idx_auto_sanitise_data_log_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_sanitise_data_log_run ON public.auto_sanitise_data_log USING btree (run_id, created_at DESC);


--
-- Name: idx_auto_send_course_completion_log_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_send_course_completion_log_run_id ON public.auto_send_course_completion_log USING btree (run_id, created_at DESC);


--
-- Name: idx_auto_send_courseware_attendance_log_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_send_courseware_attendance_log_run_id ON public.auto_send_courseware_attendance_log USING btree (run_id, created_at DESC);


--
-- Name: idx_auto_send_trainer_invitation_log_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_send_trainer_invitation_log_run_id ON public.auto_send_trainer_invitation_log USING btree (run_id, created_at DESC);


--
-- Name: idx_chat_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_conv ON public.chat_message USING btree (conversation_id, created_at);


--
-- Name: idx_company_application_application_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_application_application_id ON public.company_application USING btree (application_id);


--
-- Name: idx_company_application_company_invoice_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_application_company_invoice_batch ON public.company_application USING btree (company_invoice_batch_id);


--
-- Name: idx_company_application_course_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_application_course_run_id ON public.company_application USING btree (course_run_id);


--
-- Name: idx_company_application_employer_uen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_application_employer_uen ON public.company_application USING btree (employer_uen);


--
-- Name: idx_company_application_enrolment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_application_enrolment_id ON public.company_application USING btree (enrolment_id);


--
-- Name: idx_company_application_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_application_key ON public.company_application USING btree (application_key);


--
-- Name: idx_company_application_trainee_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_application_trainee_email ON public.company_application USING btree (trainee_email);


--
-- Name: idx_company_application_trainee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_application_trainee_id ON public.company_application USING btree (trainee_id);


--
-- Name: idx_company_invoice_batch_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_invoice_batch_company ON public.company_invoice_batch USING btree (company_uen, company_name);


--
-- Name: idx_company_invoice_batch_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_invoice_batch_course ON public.company_invoice_batch USING btree (course_reference_number);


--
-- Name: idx_course_announcement_course_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_announcement_course_run_id ON public.course_announcement USING btree (course_run_id);


--
-- Name: idx_course_attendance_nric; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_attendance_nric ON public.course_attendance USING btree (nric);


--
-- Name: idx_course_attendance_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_attendance_session ON public.course_attendance USING btree (session_id);


--
-- Name: idx_course_run_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_run_course ON public.course_run USING btree (course_id);


--
-- Name: idx_course_run_start_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_run_start_date ON public.course_run USING btree (start_date);


--
-- Name: idx_course_run_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_run_status ON public.course_run USING btree (class_status);


--
-- Name: idx_course_session_course_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_session_course_run ON public.course_session USING btree (course_run_id);


--
-- Name: idx_course_session_trainer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_session_trainer_id ON public.course_session USING btree (trainer_id) WHERE (trainer_id IS NOT NULL);


--
-- Name: idx_da_application_application_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_da_application_application_id ON public.da_application USING btree (application_id);


--
-- Name: idx_da_application_auto_enrol_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_da_application_auto_enrol_status ON public.da_application USING btree (auto_enrol_status);


--
-- Name: idx_da_application_company_invoice_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_da_application_company_invoice_batch ON public.da_application USING btree (company_invoice_batch_id);


--
-- Name: idx_da_application_course_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_da_application_course_run_id ON public.da_application USING btree (course_run_id);


--
-- Name: idx_da_application_employer_uen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_da_application_employer_uen ON public.da_application USING btree (employer_uen);


--
-- Name: idx_da_application_trainee_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_da_application_trainee_email ON public.da_application USING btree (trainee_email);


--
-- Name: idx_da_application_trainee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_da_application_trainee_id ON public.da_application USING btree (trainee_id);


--
-- Name: idx_da_application_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_da_application_user_id ON public.da_application USING btree (user_id);


--
-- Name: idx_enrollment_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollment_course ON public.enrollment USING btree (course_id);


--
-- Name: idx_enrollment_enrolment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollment_enrolment_id ON public.enrollment USING btree (enrolment_id);


--
-- Name: idx_enrollment_nric; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollment_nric ON public.enrollment USING btree (nric);


--
-- Name: idx_enrollment_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollment_user ON public.enrollment USING btree (user_id);


--
-- Name: idx_grant_import_audit_logs_batch_event_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_import_audit_logs_batch_event_at ON public.grant_import_audit_logs USING btree (batch_id, event_at DESC);


--
-- Name: idx_grant_import_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_import_batches_status ON public.grant_import_batches USING btree (status);


--
-- Name: idx_grant_import_batches_uploaded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_import_batches_uploaded_at ON public.grant_import_batches USING btree (uploaded_at DESC);


--
-- Name: idx_grant_import_rows_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_import_rows_batch ON public.grant_import_rows USING btree (batch_id);


--
-- Name: idx_grant_import_rows_enrolment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_import_rows_enrolment_id ON public.grant_import_rows USING btree (enrolment_id);


--
-- Name: idx_grant_import_rows_ftx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_import_rows_ftx ON public.grant_import_rows USING btree (financial_transaction_id);


--
-- Name: idx_grant_import_rows_grant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_import_rows_grant_id ON public.grant_import_rows USING btree (grant_id);


--
-- Name: idx_job_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_area ON public.job_posting USING btree (area);


--
-- Name: idx_job_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_company ON public.job_posting USING btree (company);


--
-- Name: idx_job_desc_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_desc_gin ON public.job_posting USING gin (description public.gin_trgm_ops);


--
-- Name: idx_job_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_location ON public.job_posting USING btree (location);


--
-- Name: idx_job_title_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_job_title_gin ON public.job_posting USING gin (title public.gin_trgm_ops);


--
-- Name: idx_link_assessment_submission_course_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_link_assessment_submission_course_run ON public.link_assessment_submission USING btree (course_run_id);


--
-- Name: idx_link_assessment_submission_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_link_assessment_submission_user ON public.link_assessment_submission USING btree (user_id);


--
-- Name: idx_masterlist_cal_title_date_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_masterlist_cal_title_date_unique ON public.masterlist_table USING btree (list_date, class_type, lower(TRIM(BOTH FROM course_title))) WHERE (calendar_event_id IS NOT NULL);


--
-- Name: idx_masterlist_calendar_event_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_masterlist_calendar_event_id_unique ON public.masterlist_table USING btree (calendar_event_id) WHERE (calendar_event_id IS NOT NULL);


--
-- Name: idx_masterlist_class_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_masterlist_class_id ON public.masterlist_table USING btree (class_id);


--
-- Name: idx_masterlist_class_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_masterlist_class_type ON public.masterlist_table USING btree (class_type);


--
-- Name: idx_masterlist_list_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_masterlist_list_date ON public.masterlist_table USING btree (list_date);


--
-- Name: idx_otp_codes_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_codes_email ON public.otp_codes USING btree (email);


--
-- Name: idx_otp_codes_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_codes_expires_at ON public.otp_codes USING btree (expires_at);


--
-- Name: idx_quiz_attempt_quiz_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_attempt_quiz_id ON public.quiz_attempt USING btree (quiz_id);


--
-- Name: idx_quiz_attempt_user_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quiz_attempt_user_course ON public.quiz_attempt USING btree (user_id, course_id);


--
-- Name: idx_sfc_import_audit_logs_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sfc_import_audit_logs_batch ON public.sfc_import_audit_logs USING btree (batch_id, created_at DESC);


--
-- Name: idx_sfc_import_batches_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sfc_import_batches_created_at ON public.sfc_import_batches USING btree (created_at DESC);


--
-- Name: idx_sfc_import_batches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sfc_import_batches_status ON public.sfc_import_batches USING btree (status);


--
-- Name: idx_sfc_import_rows_batch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sfc_import_rows_batch_id ON public.sfc_import_rows USING btree (batch_id);


--
-- Name: idx_sfc_import_rows_batch_row; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sfc_import_rows_batch_row ON public.sfc_import_rows USING btree (batch_id, row_index);


--
-- Name: idx_sfc_import_rows_claim_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sfc_import_rows_claim_id ON public.sfc_import_rows USING btree (claim_id);


--
-- Name: idx_ssg_enrolment_record_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ssg_enrolment_record_date ON public.ssg_enrolment_record USING btree (enrolment_date DESC);


--
-- Name: idx_ssg_enrolment_record_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ssg_enrolment_record_ref ON public.ssg_enrolment_record USING btree (enrolment_reference);


--
-- Name: idx_ssg_enrolments_grant_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ssg_enrolments_grant_payment_status ON public.ssg_enrolments USING btree (grant_payment_status);


--
-- Name: idx_ssg_enrolments_last_grant_import_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ssg_enrolments_last_grant_import_at ON public.ssg_enrolments USING btree (last_grant_import_at DESC);


--
-- Name: idx_submission_enroll; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submission_enroll ON public.submission USING btree (enrollment_id);


--
-- Name: idx_submission_user_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submission_user_course ON public.submission USING btree (enrollment_id, assessment_id);


--
-- Name: idx_support_ticket_reply_ticket_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_ticket_reply_ticket_id ON public.support_ticket_reply USING btree (ticket_id);


--
-- Name: idx_support_ticket_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_ticket_status ON public.support_ticket USING btree (status);


--
-- Name: idx_support_ticket_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_ticket_user_id ON public.support_ticket USING btree (user_id);


--
-- Name: idx_trainer_invitation_course_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainer_invitation_course_run ON public.trainer_invitation USING btree (course_run_id, created_at DESC);


--
-- Name: idx_training_provider_member_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_training_provider_member_user_id ON public.training_provider_member USING btree (user_id);


--
-- Name: idx_webhook_logs_received_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_logs_received_at ON public.webhook_logs USING btree (received_at DESC);


--
-- Name: idx_webhook_logs_webhook_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_logs_webhook_id ON public.webhook_logs USING btree (webhook_id);


--
-- Name: idx_webhooks_endpoint_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhooks_endpoint_token ON public.webhooks USING btree (endpoint_token);


--
-- Name: invoice_jobs_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_jobs_batch ON public.invoice_jobs USING btree (batch_id);


--
-- Name: invoice_jobs_invoice_no_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoice_jobs_invoice_no_unique ON public.invoice_jobs USING btree (invoice_no) WHERE (invoice_no IS NOT NULL);


--
-- Name: invoice_jobs_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_jobs_status_created ON public.invoice_jobs USING btree (status, created_at);


--
-- Name: invoice_jobs_unique_enrolment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoice_jobs_unique_enrolment ON public.invoice_jobs USING btree (enrolment_id);


--
-- Name: ssg_course_runs_reference_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ssg_course_runs_reference_number_idx ON public.ssg_course_runs USING btree (reference_number);


--
-- Name: uq_company_application_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_company_application_key ON public.company_application USING btree (application_key) WHERE ((application_key IS NOT NULL) AND (application_key <> ''::text));


--
-- Name: uq_crt_run_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_crt_run_trainer ON public.course_run_trainer USING btree (course_run_id, COALESCE(trainer_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: uq_training_provider_uen; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_training_provider_uen ON public.training_provider USING btree (uen);


--
-- Name: support_ticket support_ticket_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER support_ticket_updated_at BEFORE UPDATE ON public.support_ticket FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: da_application touch_da_application_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_da_application_updated_at BEFORE UPDATE ON public.da_application FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: app_user trg_app_user_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_app_user_touch BEFORE UPDATE ON public.app_user FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: assessment trg_assessment_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assessment_touch BEFORE UPDATE ON public.assessment FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: course_run trg_course_run_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_course_run_touch BEFORE UPDATE ON public.course_run FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: course trg_course_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_course_touch BEFORE UPDATE ON public.course FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: enrollment trg_enrollment_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enrollment_touch BEFORE UPDATE ON public.enrollment FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: job_posting trg_job_posting_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_job_posting_touch BEFORE UPDATE ON public.job_posting FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: training_provider trg_training_provider_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_training_provider_touch BEFORE UPDATE ON public.training_provider FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: admin_profile admin_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_profile
    ADD CONSTRAINT admin_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: assessment assessment_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment
    ADD CONSTRAINT assessment_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;


--
-- Name: assessment_grade assessment_grade_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_grade
    ADD CONSTRAINT assessment_grade_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessment(id) ON DELETE CASCADE;


--
-- Name: assessment_grade assessment_grade_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessment_grade
    ADD CONSTRAINT assessment_grade_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollment(id) ON DELETE CASCADE;


--
-- Name: calendar_event calendar_event_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_event
    ADD CONSTRAINT calendar_event_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;


--
-- Name: certification certification_developer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certification
    ADD CONSTRAINT certification_developer_id_fkey FOREIGN KEY (developer_id) REFERENCES public.developer_profile(user_id);


--
-- Name: chat_conversation chat_conversation_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversation
    ADD CONSTRAINT chat_conversation_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: chat_message chat_message_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message
    ADD CONSTRAINT chat_message_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.chat_conversation(id) ON DELETE CASCADE;


--
-- Name: company_application company_application_company_invoice_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_application
    ADD CONSTRAINT company_application_company_invoice_batch_id_fkey FOREIGN KEY (company_invoice_batch_id) REFERENCES public.company_invoice_batch(id) ON DELETE SET NULL;


--
-- Name: course_announcement course_announcement_course_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_announcement
    ADD CONSTRAINT course_announcement_course_run_id_fkey FOREIGN KEY (course_run_id) REFERENCES public.course_run(id) ON DELETE CASCADE;


--
-- Name: course_attendance course_attendance_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_attendance
    ADD CONSTRAINT course_attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.course_session(id) ON DELETE CASCADE;


--
-- Name: course_attendance course_attendance_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_attendance
    ADD CONSTRAINT course_attendance_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: course_run_assessment course_run_assessment_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run_assessment
    ADD CONSTRAINT course_run_assessment_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessment(id) ON DELETE CASCADE;


--
-- Name: course_run_assessment course_run_assessment_course_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run_assessment
    ADD CONSTRAINT course_run_assessment_course_run_id_fkey FOREIGN KEY (course_run_id) REFERENCES public.course_run(id) ON DELETE CASCADE;


--
-- Name: course_run course_run_assigned_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run
    ADD CONSTRAINT course_run_assigned_trainer_id_fkey FOREIGN KEY (assigned_trainer_id) REFERENCES public.trainer_profile(user_id) ON DELETE SET NULL;


--
-- Name: course_run course_run_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run
    ADD CONSTRAINT course_run_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;


--
-- Name: course_run_trainer course_run_trainer_course_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_run_trainer
    ADD CONSTRAINT course_run_trainer_course_run_id_fkey FOREIGN KEY (course_run_id) REFERENCES public.course_run(id) ON DELETE CASCADE;


--
-- Name: course_session course_session_course_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_session
    ADD CONSTRAINT course_session_course_run_id_fkey FOREIGN KEY (course_run_id) REFERENCES public.course_run(id) ON DELETE CASCADE;


--
-- Name: cp_prompt_template cp_prompt_template_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cp_prompt_template
    ADD CONSTRAINT cp_prompt_template_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.app_user(id) ON DELETE SET NULL;


--
-- Name: developer_profile developer_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.developer_profile
    ADD CONSTRAINT developer_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: enrollment enrollment_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollment
    ADD CONSTRAINT enrollment_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;


--
-- Name: enrollment enrollment_course_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollment
    ADD CONSTRAINT enrollment_course_run_id_fkey FOREIGN KEY (course_run_id) REFERENCES public.course_run(id) ON DELETE CASCADE;


--
-- Name: enrollment enrollment_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollment
    ADD CONSTRAINT enrollment_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: finance_profile finance_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_profile
    ADD CONSTRAINT finance_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: certification fk_trainer_certification_trainer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certification
    ADD CONSTRAINT fk_trainer_certification_trainer FOREIGN KEY (trainer_id) REFERENCES public.trainer_profile(user_id) ON DELETE CASCADE;


--
-- Name: work_experience fk_trainer_work_experience_trainer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_experience
    ADD CONSTRAINT fk_trainer_work_experience_trainer FOREIGN KEY (trainer_id) REFERENCES public.trainer_profile(user_id) ON DELETE CASCADE;


--
-- Name: training_provider_api fk_training_provider_api_provider; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_provider_api
    ADD CONSTRAINT fk_training_provider_api_provider FOREIGN KEY (training_provider_id) REFERENCES public.training_provider(id) ON DELETE CASCADE;


--
-- Name: user_subtopic_bookmark fk_user_subtopic_bookmark_course_run; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subtopic_bookmark
    ADD CONSTRAINT fk_user_subtopic_bookmark_course_run FOREIGN KEY (course_run_id) REFERENCES public.course_run(id) ON DELETE CASCADE;


--
-- Name: grant_import_audit_logs grant_import_audit_logs_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_import_audit_logs
    ADD CONSTRAINT grant_import_audit_logs_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.grant_import_batches(id) ON DELETE CASCADE;


--
-- Name: grant_import_audit_logs grant_import_audit_logs_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_import_audit_logs
    ADD CONSTRAINT grant_import_audit_logs_row_id_fkey FOREIGN KEY (row_id) REFERENCES public.grant_import_rows(id) ON DELETE SET NULL;


--
-- Name: grant_import_rows grant_import_rows_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_import_rows
    ADD CONSTRAINT grant_import_rows_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.grant_import_batches(id) ON DELETE CASCADE;


--
-- Name: learner_profile learner_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learner_profile
    ADD CONSTRAINT learner_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: learning_unit learning_unit_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.learning_unit
    ADD CONSTRAINT learning_unit_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;


--
-- Name: link_assessment_submission link_assessment_submission_course_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.link_assessment_submission
    ADD CONSTRAINT link_assessment_submission_course_run_id_fkey FOREIGN KEY (course_run_id) REFERENCES public.course_run(id) ON DELETE CASCADE;


--
-- Name: link_assessment_submission link_assessment_submission_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.link_assessment_submission
    ADD CONSTRAINT link_assessment_submission_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: provider_admin_user provider_admin_user_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_admin_user
    ADD CONSTRAINT provider_admin_user_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.training_provider(id) ON DELETE CASCADE;


--
-- Name: provider_admin_user provider_admin_user_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_admin_user
    ADD CONSTRAINT provider_admin_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: quiz_attempt quiz_attempt_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;


--
-- Name: quiz_attempt quiz_attempt_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_attempt
    ADD CONSTRAINT quiz_attempt_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: sfc_import_audit_logs sfc_import_audit_logs_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfc_import_audit_logs
    ADD CONSTRAINT sfc_import_audit_logs_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.sfc_import_batches(id) ON DELETE CASCADE;


--
-- Name: sfc_import_audit_logs sfc_import_audit_logs_row_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfc_import_audit_logs
    ADD CONSTRAINT sfc_import_audit_logs_row_id_fkey FOREIGN KEY (row_id) REFERENCES public.sfc_import_rows(id) ON DELETE SET NULL;


--
-- Name: sfc_import_rows sfc_import_rows_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sfc_import_rows
    ADD CONSTRAINT sfc_import_rows_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.sfc_import_batches(id) ON DELETE CASCADE;


--
-- Name: submission submission_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission
    ADD CONSTRAINT submission_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessment(id) ON DELETE CASCADE;


--
-- Name: submission submission_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission
    ADD CONSTRAINT submission_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollment(id) ON DELETE CASCADE;


--
-- Name: subtopic subtopic_learning_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtopic
    ADD CONSTRAINT subtopic_learning_unit_id_fkey FOREIGN KEY (learning_unit_id) REFERENCES public.learning_unit(id) ON DELETE CASCADE;


--
-- Name: support_ticket_reply support_ticket_reply_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_reply
    ADD CONSTRAINT support_ticket_reply_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_ticket(id) ON DELETE CASCADE;


--
-- Name: support_ticket_reply support_ticket_reply_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_reply
    ADD CONSTRAINT support_ticket_reply_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id);


--
-- Name: support_ticket support_ticket_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket
    ADD CONSTRAINT support_ticket_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id);


--
-- Name: trainer_invitation trainer_invitation_course_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_invitation
    ADD CONSTRAINT trainer_invitation_course_run_id_fkey FOREIGN KEY (course_run_id) REFERENCES public.course_run(id) ON DELETE CASCADE;


--
-- Name: trainer_profile trainer_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_profile
    ADD CONSTRAINT trainer_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: training_provider_member training_provider_member_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_provider_member
    ADD CONSTRAINT training_provider_member_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.training_provider(id) ON DELETE CASCADE;


--
-- Name: training_provider_member training_provider_member_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_provider_member
    ADD CONSTRAINT training_provider_member_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_role_map user_role_map_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_role_map
    ADD CONSTRAINT user_role_map_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_saved_job user_saved_job_job_posting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_job
    ADD CONSTRAINT user_saved_job_job_posting_id_fkey FOREIGN KEY (job_posting_id) REFERENCES public.job_posting(id) ON DELETE CASCADE;


--
-- Name: user_saved_job user_saved_job_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_job
    ADD CONSTRAINT user_saved_job_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: user_subtopic_bookmark user_subtopic_bookmark_subtopic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subtopic_bookmark
    ADD CONSTRAINT user_subtopic_bookmark_subtopic_id_fkey FOREIGN KEY (subtopic_id) REFERENCES public.subtopic(id) ON DELETE CASCADE;


--
-- Name: user_subtopic_bookmark user_subtopic_bookmark_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_subtopic_bookmark
    ADD CONSTRAINT user_subtopic_bookmark_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- Name: webhook_logs webhook_logs_webhook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_logs
    ADD CONSTRAINT webhook_logs_webhook_id_fkey FOREIGN KEY (webhook_id) REFERENCES public.webhooks(id) ON DELETE CASCADE;


--
-- Name: work_experience work_experience_developer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_experience
    ADD CONSTRAINT work_experience_developer_id_fkey FOREIGN KEY (developer_id) REFERENCES public.developer_profile(user_id);


--
-- PostgreSQL database dump complete
--

\unrestrict KPNzHcMuzw6FCNWgTSTZDEZ2rYp7EPkK9WX1jIHroBHCJuH1Vh42QYLbtRA63fn

