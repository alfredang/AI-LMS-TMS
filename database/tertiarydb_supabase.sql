--
-- PostgreSQL database dump
--


-- Dumped from database version 17.7
-- Dumped by pg_dump version 17.7

-- Started on 2026-01-21 00:30:37

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
-- TOC entry 2 (class 3079 OID 16389)
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- TOC entry 5340 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- TOC entry 3 (class 3079 OID 16470)
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- TOC entry 5341 (class 0 OID 0)
-- Dependencies: 3
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- TOC entry 948 (class 1247 OID 16508)
-- Name: admin_page; Type: TYPE; Schema: public; Owner: postgres
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


-- Ownership managed by Supabase

--
-- TOC entry 951 (class 1247 OID 16548)
-- Name: age_group; Type: TYPE; Schema: public; Owner: postgres
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


-- Ownership managed by Supabase

--
-- TOC entry 954 (class 1247 OID 16574)
-- Name: app_view; Type: TYPE; Schema: public; Owner: postgres
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


-- Ownership managed by Supabase

--
-- TOC entry 957 (class 1247 OID 16594)
-- Name: assessment_category; Type: TYPE; Schema: public; Owner: postgres
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


-- Ownership managed by Supabase

--
-- TOC entry 960 (class 1247 OID 16614)
-- Name: assessment_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.assessment_status AS ENUM (
    'Draft',
    'Published'
);


-- Ownership managed by Supabase

--
-- TOC entry 963 (class 1247 OID 16620)
-- Name: calendar_event_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.calendar_event_type AS ENUM (
    'quiz',
    'assignment',
    'lecture',
    'event'
);


-- Ownership managed by Supabase

--
-- TOC entry 966 (class 1247 OID 16630)
-- Name: chat_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.chat_role AS ENUM (
    'user',
    'model'
);


-- Ownership managed by Supabase

--
-- TOC entry 969 (class 1247 OID 16636)
-- Name: class_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.class_status AS ENUM (
    'Confirmed',
    'Pending',
    'Cancelled',
    'Reschedule'
);


-- Ownership managed by Supabase

--
-- TOC entry 972 (class 1247 OID 16646)
-- Name: company_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.company_type AS ENUM (
    'SME',
    'MNC',
    'Government',
    'Startup',
    'N/A'
);


-- Ownership managed by Supabase

--
-- TOC entry 975 (class 1247 OID 16658)
-- Name: course_payment_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.course_payment_status AS ENUM (
    'Paid',
    'Pending',
    'Overdue'
);


-- Ownership managed by Supabase

--
-- TOC entry 978 (class 1247 OID 16666)
-- Name: course_sponsorship; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.course_sponsorship AS ENUM (
    'Self-Sponsored',
    'Employer-Sponsored',
    'N/A'
);


-- Ownership managed by Supabase

--
-- TOC entry 981 (class 1247 OID 16674)
-- Name: course_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.course_type AS ENUM (
    'WSQ',
    'IBF',
    'non-WSQ',
    'Non-WSQ'
);


-- Ownership managed by Supabase

--
-- TOC entry 984 (class 1247 OID 16684)
-- Name: developer_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.developer_type AS ENUM (
    'DACE',
    'DDDPL',
    'N/A'
);


-- Ownership managed by Supabase

--
-- TOC entry 987 (class 1247 OID 16692)
-- Name: education; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.education AS ENUM (
    'Diploma',
    'Degree',
    'Master',
    'PhD'
);


-- Ownership managed by Supabase

--
-- TOC entry 990 (class 1247 OID 16702)
-- Name: employment_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.employment_status AS ENUM (
    'Employed',
    'Unemployed',
    'Looking for Job'
);


-- Ownership managed by Supabase

--
-- TOC entry 993 (class 1247 OID 16710)
-- Name: ethnicity; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.ethnicity AS ENUM (
    'Chinese',
    'Malay',
    'Indian',
    'Others'
);


-- Ownership managed by Supabase

--
-- TOC entry 996 (class 1247 OID 16720)
-- Name: gender; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.gender AS ENUM (
    'Male',
    'Female',
    'Prefer not to say'
);


-- Ownership managed by Supabase

--
-- TOC entry 999 (class 1247 OID 16728)
-- Name: grade_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.grade_status AS ENUM (
    'Pass',
    'Fail',
    'Pending'
);


-- Ownership managed by Supabase

--
-- TOC entry 1002 (class 1247 OID 16736)
-- Name: grant_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.grant_status AS ENUM (
    'Pending',
    'Approved',
    'Rejected'
);


-- Ownership managed by Supabase

--
-- TOC entry 1005 (class 1247 OID 16744)
-- Name: learner_payment_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.learner_payment_status AS ENUM (
    'Paid',
    'Unpaid'
);


-- Ownership managed by Supabase

--
-- TOC entry 1008 (class 1247 OID 16750)
-- Name: mode_of_learning; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.mode_of_learning AS ENUM (
    'Physical',
    'Virtual',
    'Hybrid'
);


-- Ownership managed by Supabase

--
-- TOC entry 1011 (class 1247 OID 16758)
-- Name: nationality; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.nationality AS ENUM (
    'Singaporean',
    'Singapore PR',
    'Non Citizen'
);


-- Ownership managed by Supabase

--
-- TOC entry 1014 (class 1247 OID 16766)
-- Name: qualification; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.qualification AS ENUM (
    'ACLP',
    'DACE'
);


-- Ownership managed by Supabase

--
-- TOC entry 1017 (class 1247 OID 16772)
-- Name: tpg_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.tpg_status AS ENUM (
    'Success',
    'Pending',
    'Processing',
    'Failed',
    'N/A'
);


-- Ownership managed by Supabase

--
-- TOC entry 1020 (class 1247 OID 16784)
-- Name: trainer_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.trainer_status AS ENUM (
    'Active',
    'Inactive'
);


-- Ownership managed by Supabase

--
-- TOC entry 1023 (class 1247 OID 16790)
-- Name: trainer_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.trainer_type AS ENUM (
    'ACLP',
    'non-ACLP',
    'DACE'
);


-- Ownership managed by Supabase

--
-- TOC entry 1026 (class 1247 OID 16798)
-- Name: user_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.user_role AS ENUM (
    'Learner',
    'Trainer',
    'Admin',
    'Developer',
    'Training Provider'
);


-- Ownership managed by Supabase

--
-- TOC entry 307 (class 1255 OID 16809)
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- Ownership managed by Supabase

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 219 (class 1259 OID 16810)
-- Name: admin_profile; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admin_profile (
    user_id uuid NOT NULL,
    tel text NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 220 (class 1259 OID 16815)
-- Name: app_user; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    password_hash text NOT NULL,
    full_name text NOT NULL,
    profile_picture_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_valid CHECK ((POSITION(('@'::text) IN (email)) > 1))
);


-- Ownership managed by Supabase

--
-- TOC entry 221 (class 1259 OID 16824)
-- Name: assessment; Type: TABLE; Schema: public; Owner: postgres
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


-- Ownership managed by Supabase

--
-- TOC entry 222 (class 1259 OID 16832)
-- Name: assessment_grade; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assessment_grade (
    enrollment_id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    status public.grade_status NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 223 (class 1259 OID 16835)
-- Name: calendar_event; Type: TABLE; Schema: public; Owner: postgres
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


-- Ownership managed by Supabase

--
-- TOC entry 224 (class 1259 OID 16840)
-- Name: calendar_event_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.calendar_event_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


-- Ownership managed by Supabase

--
-- TOC entry 5342 (class 0 OID 0)
-- Dependencies: 224
-- Name: calendar_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.calendar_event_id_seq OWNED BY public.calendar_event.id;


--
-- TOC entry 225 (class 1259 OID 16841)
-- Name: certification; Type: TABLE; Schema: public; Owner: postgres
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


-- Ownership managed by Supabase

--
-- TOC entry 226 (class 1259 OID 16849)
-- Name: chat_conversation; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_conversation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 227 (class 1259 OID 16854)
-- Name: chat_message; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_message (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role public.chat_role NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 228 (class 1259 OID 16861)
-- Name: course; Type: TABLE; Schema: public; Owner: postgres
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
    CONSTRAINT course_assessment_hours_check CHECK ((assessment_hours >= (0)::numeric)),
    CONSTRAINT course_course_fee_check CHECK ((course_fee >= (0)::numeric)),
    CONSTRAINT course_dates CHECK ((end_date >= start_date)),
    CONSTRAINT course_enrollment_status_check CHECK ((enrollment_status = ANY (ARRAY['enrolled'::text, 'not-enrolled'::text]))),
    CONSTRAINT course_tax_percent_check CHECK ((tax_percent >= (0)::numeric)),
    CONSTRAINT course_training_hours_check CHECK ((training_hours >= (0)::numeric))
);


-- Ownership managed by Supabase

--
-- TOC entry 229 (class 1259 OID 16882)
-- Name: course_run; Type: TABLE; Schema: public; Owner: postgres
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
    CONSTRAINT course_run_dates CHECK ((end_date >= start_date))
);


-- Ownership managed by Supabase

--
-- TOC entry 230 (class 1259 OID 16892)
-- Name: course_run_assessment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.course_run_assessment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_run_id uuid NOT NULL,
    assessment_id uuid NOT NULL,
    published boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone
);


-- Ownership managed by Supabase

--
-- TOC entry 231 (class 1259 OID 16897)
-- Name: developer_profile; Type: TABLE; Schema: public; Owner: postgres
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
    cv_original_filename text
);


-- Ownership managed by Supabase

--
-- TOC entry 232 (class 1259 OID 16905)
-- Name: enrollment; Type: TABLE; Schema: public; Owner: postgres
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
    CONSTRAINT enrollment_progress_percent_check CHECK (((progress_percent >= (0)::numeric) AND (progress_percent <= (100)::numeric)))
);


-- Ownership managed by Supabase

--
-- TOC entry 233 (class 1259 OID 16916)
-- Name: job_posting; Type: TABLE; Schema: public; Owner: postgres
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


-- Ownership managed by Supabase

--
-- TOC entry 234 (class 1259 OID 16927)
-- Name: learner_profile; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.learner_profile (
    user_id uuid NOT NULL,
    tel text NOT NULL,
    nric text,
    gender public.gender NOT NULL,
    company text NOT NULL,
    employment_status public.employment_status NOT NULL,
    nationality public.nationality NOT NULL,
    ethnicity public.ethnicity NOT NULL,
    dob date NOT NULL,
    invoice_url text,
    receipt_url text,
    pro_forma_url text
);


-- Ownership managed by Supabase

--
-- TOC entry 235 (class 1259 OID 16932)
-- Name: learning_unit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.learning_unit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid NOT NULL,
    title text NOT NULL,
    "position" integer DEFAULT 1 NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 236 (class 1259 OID 16939)
-- Name: provider_admin_user; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.provider_admin_user (
    provider_id uuid NOT NULL,
    user_id uuid NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 237 (class 1259 OID 16942)
-- Name: ssg_claims; Type: TABLE; Schema: public; Owner: postgres
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
    raw_data jsonb
);


-- Ownership managed by Supabase

--
-- TOC entry 238 (class 1259 OID 16950)
-- Name: ssg_enrolments; Type: TABLE; Schema: public; Owner: postgres
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
    raw_data jsonb
);


-- Ownership managed by Supabase

--
-- TOC entry 239 (class 1259 OID 16958)
-- Name: ssg_grants; Type: TABLE; Schema: public; Owner: postgres
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
    api_response jsonb
);


-- Ownership managed by Supabase

--
-- TOC entry 240 (class 1259 OID 16966)
-- Name: submission; Type: TABLE; Schema: public; Owner: postgres
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


-- Ownership managed by Supabase

--
-- TOC entry 241 (class 1259 OID 16972)
-- Name: subtopic; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subtopic (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    learning_unit_id uuid NOT NULL,
    title text NOT NULL,
    "position" integer DEFAULT 1 NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 242 (class 1259 OID 16979)
-- Name: subtopic_completion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subtopic_completion (
    enrollment_id uuid NOT NULL,
    subtopic_id uuid NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 243 (class 1259 OID 16983)
-- Name: trainer_profile; Type: TABLE; Schema: public; Owner: postgres
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
    cv_original_filename text
);


-- Ownership managed by Supabase

--
-- TOC entry 244 (class 1259 OID 16990)
-- Name: training_provider; Type: TABLE; Schema: public; Owner: postgres
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
    gst_register boolean DEFAULT false NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 245 (class 1259 OID 17015)
-- Name: training_provider_api; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.training_provider_api (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    training_provider_id uuid NOT NULL,
    key_name text NOT NULL,
    key_value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 246 (class 1259 OID 17023)
-- Name: user_role_map; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_role_map (
    user_id uuid NOT NULL,
    role public.user_role NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 247 (class 1259 OID 17026)
-- Name: user_saved_job; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_saved_job (
    user_id uuid NOT NULL,
    job_posting_id uuid NOT NULL,
    saved_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 248 (class 1259 OID 17030)
-- Name: user_subtopic_bookmark; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_subtopic_bookmark (
    user_id uuid NOT NULL,
    subtopic_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    course_run_id uuid NOT NULL
);


-- Ownership managed by Supabase

--
-- TOC entry 249 (class 1259 OID 17034)
-- Name: work_experience; Type: TABLE; Schema: public; Owner: postgres
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


-- Ownership managed by Supabase

--
-- TOC entry 4930 (class 2604 OID 17042)
-- Name: calendar_event id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_event ALTER COLUMN id SET DEFAULT nextval('public.calendar_event_id_seq'::regclass);


--
-- TOC entry 5304 (class 0 OID 16810)
-- Dependencies: 219
-- Data for Name: admin_profile; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.admin_profile (user_id, tel) VALUES ('33333333-3333-4333-8333-333333333333', '96983731');


--
-- TOC entry 5305 (class 0 OID 16815)
-- Dependencies: 220
-- Data for Name: app_user; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.app_user (id, email, password, password_hash, full_name, profile_picture_url, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', 'guanhong01@hotmail.com', 'guanhong123', '$2b$10$gKozZ7Eh.yqtTPg4fWLXQehR/0Hpz9FfXiTGKUerQ.fzRQsL9gMvK', 'Tan Guan Hong', 'https://i.pravatar.cc/150?img=4', '2025-09-04 15:22:38.896186+08', '2025-10-10 17:05:47.696215+08');
INSERT INTO public.app_user (id, email, password, password_hash, full_name, profile_picture_url, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111112', 'taeguksep3@gmail.com', 'thun123', '$2b$10$hCt0y3nwX2F2yd00dNU/POGtVBJlFD1VzDTMZ7SJtrJvvcK6jjeJK', 'Thun Pyae Lin', 'https://i.pravatar.cc/150?img=37', '2025-09-04 15:22:38.896186+08', '2025-10-10 17:07:01.130762+08');
INSERT INTO public.app_user (id, email, password, password_hash, full_name, profile_picture_url, created_at, updated_at) VALUES ('44444444-4444-4444-8444-444444444444', 'lz624827316@gmail.com', 'liuzhen123', '$2b$10$/S3IFfMTB.1OsnLzNEuWXudMyCP.YFR24ZrLAD78KfAhR4BKEyfVC', 'Liu Zhen', 'https://i.pravatar.cc/150?img=11', '2025-09-04 15:22:38.896186+08', '2025-10-10 17:09:04.170125+08');
INSERT INTO public.app_user (id, email, password, password_hash, full_name, profile_picture_url, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111113', 'maythetnaingbo.contact@gmail.com', 'may1234', '$2b$10$WSd5DcDnKA3wQUyTnlKEUOycaszCS5oTnLvl79BQJdYiVumNcjq.u', 'May1', 'https://i.pravatar.cc/150?img=23', '2025-09-04 15:22:38.896186+08', '2025-10-13 11:13:30.51764+08');
INSERT INTO public.app_user (id, email, password, password_hash, full_name, profile_picture_url, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333333', 'leepeng@tertiaryinfotech.com', 'tertiary888', '$2b$10$U6mBXcAyg36wixuHnlIKi.XfwUXhxztOy9qPtp2K15aMBCu94gU7G', 'Dr Alfred Ang', 'https://i.pravatar.cc/150?img=13', '2025-09-04 15:22:38.896186+08', '2025-10-14 10:32:06.00832+08');
INSERT INTO public.app_user (id, email, password, password_hash, full_name, profile_picture_url, created_at, updated_at) VALUES ('55555555-5555-5555-8555-555555555555', 'tertiary_infotech@gmail.com', 'tertiary123', '$2b$10$R78KMh/2f.tqXEuUEYFg7u8JqtDmZIIwLJ.MxbUG64A9HX5zSMGnK', 'Debug Test Company', '/uploads/training_provider/company_logo/1759475351223_tertiary_logo.png', '2025-09-04 15:22:38.896186+08', '2025-10-14 10:57:59.083095+08');
INSERT INTO public.app_user (id, email, password, password_hash, full_name, profile_picture_url, created_at, updated_at) VALUES ('fb090496-d9a5-47bf-8c31-439d04d4d4a9', 'alvinang8888@gmail.com', 'Tertiary888', '$2b$10$1KABvwQHPeFRkCemNQVorekV4B6yQ1IBfQIZhm/iwNQqXmotBdm7S', 'Alvin Ang', '/uploads/trainers/profilePicture/1761789258500_Alvin_Ang.jpg', '2025-10-30 09:54:18.646867+08', '2025-10-30 09:54:18.646867+08');
INSERT INTO public.app_user (id, email, password, password_hash, full_name, profile_picture_url, created_at, updated_at) VALUES ('7f22c45d-bda8-495c-9a4e-9135eecc0d52', 'jasminesho@gmail.com', 'Tertiary888', '$2b$10$.72PFTOveJn.G4SfdexlCedHTV.rzu4IvEIBp6QfKVXHvLW/QK/ny', 'Jasmine Sho Choon Kim', '/uploads/trainers/profilePicture/trainer_1761791066298_4xkc8jcmd.jpg', '2025-10-30 10:24:26.304661+08', '2025-10-30 10:24:26.304661+08');
INSERT INTO public.app_user (id, email, password, password_hash, full_name, profile_picture_url, created_at, updated_at) VALUES ('e4b8b465-2209-49e3-89de-536bb43f0987', 'dnuwanf@gmail.com', 'Tertiary888', '$2b$10$oaudqqbu2RuDwyXpKYMSP.eS62W8H3yJXeqlTeLTWlTGCNEv1dhZ6', 'Dwight Nuwan Fonseka', '/uploads/trainers/profilePicture/trainer_1761802959996_7jgs3xlss.jpg', '2025-10-30 13:42:40.001217+08', '2025-10-30 13:42:40.001217+08');
INSERT INTO public.app_user (id, email, password, password_hash, full_name, profile_picture_url, created_at, updated_at) VALUES ('22222222-2222-4222-8222-222222222222', 'xinpingwong15@gmail.com', 'xinping123', '$2b$10$qwuRlpyPuTdEEYcnjwpLJerBvuo8jEhlKd6xRVUwcyCNDq1p3T0hC', 'Wong Xin Ping', '/uploads/trainers/profilePicture/1760075033066_profile_pic_3.png', '2025-09-04 15:22:38.896186+08', '2025-10-10 17:01:24.298857+08');


--
-- TOC entry 5306 (class 0 OID 16824)
-- Dependencies: 221
-- Data for Name: assessment; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('971d22cf-6b2b-4de8-905a-046ab7df75d9', '8cece47b-33a9-46e6-b7c6-cf678f57d1dd', 'Written Assignment - TGS-2019504591', 'Assignments', 'Draft', NULL, '/assessments/WA (SAQ) - TGS-2019504591 - Advancing Your Python Coding Skills to the Next Level with Object-Oriented Programming - v15.docx', '2025-09-29 11:55:10.185167+08', '2025-09-29 15:41:54.99097+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('6dbda35c-e560-4b26-838d-3f66cad468cf', '8cece47b-33a9-46e6-b7c6-cf678f57d1dd', 'Case Study Assessment - TGS-2019504591', 'Assignments', 'Draft', NULL, '/assessments/CS Assessment- TGS-2019504591 - Advancing Your Python Coding Skills to the Next Level with Object-Oriented Programming - v16.docx', '2025-09-29 11:55:10.185167+08', '2025-09-29 15:41:54.99097+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('2e1a95e5-b2b3-4329-a411-53ffba9010e1', '9482c77e-2830-4646-b15e-b263d744a0fc', 'Practical Performance Assessment', 'Practical Exam', 'Draft', NULL, '/assessments/PP Assessment - TGS-2019504744 - Building Your First Machine Learning Model with Python and Tensorflow - v13.docx', '2025-09-29 14:45:19.17628+08', '2025-10-01 13:56:31.505752+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('d8ecfc01-974a-4a91-9251-c1cb0e3ced8d', '9482c77e-2830-4646-b15e-b263d744a0fc', 'Written Assessment', 'Written Exam', 'Draft', NULL, '/assessments/WA (SAQ) - TGS-2019504744 - Building Your First Machine Learning Model with Python and Tensorflow - v13.docx', '2025-09-29 14:45:19.17628+08', '2025-10-01 13:56:31.505752+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('b3c509c2-72d9-4074-b38d-25bec7b53ec9', '497b25e3-fda4-4c84-a309-656a0433b987', 'CS Assessment- TGS-2019504643', 'Assignments', 'Draft', NULL, '/assessments/CS Assessment- TGS-2019504643 - Basic Machine Learning with Scikit-Learn Course - v12.docx', '2025-09-29 14:28:45.953536+08', '2025-09-29 14:28:45.953536+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('028a5278-36b5-4ada-b88e-e7a23fb09e30', '497b25e3-fda4-4c84-a309-656a0433b987', 'Oral Questioning - TGS-2019504643', 'Oral Questioning', 'Draft', NULL, '/assessments/Oral Questioning (OQ) - Basic Machine Learning with Scikit-Learn Course - v1.docx', '2025-09-29 14:28:45.953536+08', '2025-09-29 14:28:45.953536+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('dcb84e33-bd3c-46a7-8645-6985062a88c9', '497b25e3-fda4-4c84-a309-656a0433b987', 'Written Assessment - TGS-2019504643', 'Assignments', 'Draft', NULL, '/assessments/WA (SAQ) - TGS-2019504643 - Basic Machine Learning with Scikit-Learn Course - v12.docx', '2025-09-29 14:28:45.953536+08', '2025-09-29 14:28:45.953536+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('2d3447fc-6abf-471c-9914-a4bb53c3dd0a', '51315b70-bfb5-44ff-ba7b-cc16bd3040c4', 'Oral Questioning', 'Oral Questioning', 'Draft', NULL, '/assessments/(OQ) - TGS-2020503109 - Creating High-Converting Email Campaigns with Mailchimp - v7.docx', '2025-09-29 14:55:43.387746+08', '2025-09-29 14:55:43.387746+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('175926f4-450f-4933-b419-e6d339a618eb', '51315b70-bfb5-44ff-ba7b-cc16bd3040c4', 'Practical Performance Assessment', 'Practical Exam', 'Draft', NULL, '/assessments/PP Assessment- TGS-2020503109 - Creating High-Converting Email Campaigns with Mailchimp - v9.docx', '2025-09-29 14:55:43.387746+08', '2025-09-29 14:55:43.387746+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('b8180ae3-7c74-4cf1-9724-325e509305fd', '51315b70-bfb5-44ff-ba7b-cc16bd3040c4', 'Written Assessment', 'Written Exam', 'Draft', NULL, '/assessments/WA (SAQ) - TGS-2020503109 - Creating High-Converting Email Campaigns with Mailchimp - v8.docx', '2025-09-29 14:55:43.387746+08', '2025-09-29 14:55:43.387746+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('eb65fcb5-1a78-4fc6-9e9f-04e343799dea', '53c1cb78-3ba0-4576-8f2b-27bd52e55317', 'Practical Performance Assessment', 'Practical Exam', 'Draft', NULL, '/assessments/PP Assessment - TGS-2020503264 - Data Mining and Machine Learning Fundamentals for Beginners - v12.docx', '2025-09-29 15:02:01.338341+08', '2025-09-29 15:02:01.338341+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('aecc3836-27a3-44cc-8056-3ed892d1020e', '53c1cb78-3ba0-4576-8f2b-27bd52e55317', 'Written Assessment', 'Written Exam', 'Draft', NULL, '/assessments/WA (SAQ) - TGS-2020503264 - Data Mining and Machine Learning Fundamentals for Beginners - v12.docx', '2025-09-29 15:02:01.338341+08', '2025-09-29 15:02:01.338341+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('e72dc913-59a8-47af-8889-a6d9bce7da4b', '834d78e0-d30e-4007-8434-642fde67f93a', 'Oral Questioning', 'Oral Questioning', 'Draft', NULL, '/assessments/Oral Questioning (OQ) - Data Visualisation with Tableau - v2.docx', '2025-09-29 15:07:01.244898+08', '2025-09-29 15:07:01.244898+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('dcf201ce-1f2b-4b7d-b089-49c84bd7d584', '834d78e0-d30e-4007-8434-642fde67f93a', 'Practical Performance Assessment', 'Practical Exam', 'Draft', NULL, '/assessments/PP Assessment - TGS-2020503177 - Data Visualisation with Tableau - v11.docx', '2025-09-29 15:07:01.244898+08', '2025-09-29 15:07:01.244898+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('2bc4cfbe-1cc6-4369-b8b8-2fa921bec8a6', 'a68ad2c6-7e32-4f0f-a600-644434598d24', 'Practical Performance Assessment', 'Practical Exam', 'Draft', NULL, '/assessments/PP Assessment - TGS-2020503207 - Developing Advanced Machine Learning Applications with Python and Tensorflow - v13.docx', '2025-09-29 15:11:17.273094+08', '2025-09-29 15:11:17.273094+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('67c2f4f9-c950-4424-bd8c-6f63bb1dfb17', 'a68ad2c6-7e32-4f0f-a600-644434598d24', 'Written Assessment', 'Written Exam', 'Draft', NULL, '/assessments/WA (SAQ) - TGS-2020503207 - Developing Advanced Machine Learning Applications with Python and Tensorflow - v12.docx', '2025-09-29 15:11:17.273094+08', '2025-09-29 15:11:17.273094+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('bfff7712-cff8-44cb-b050-edff18a568d4', '71cc9df6-3487-4b52-9a73-094f33bd4634', 'Written Assessment', 'Written Exam', 'Draft', NULL, '/assessments/WA(SAQ) - Python Fundamental Course for Beginners - v8.docx', '2025-09-29 15:18:44.639333+08', '2025-09-29 15:18:44.639333+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('e2b532f5-efa8-4cfc-ab48-e5150437bdfa', '3ac6b597-55df-4df1-ad20-d009976416c2', 'Case Study', 'Assignments', 'Draft', NULL, '/assessments/CS Assessment- TGS-2019504058 - R Fundamental and Statistical Analysis for Beginners - v10.docx', '2025-09-29 15:28:19.485869+08', '2025-09-29 15:28:19.485869+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('022dca4a-21d3-4047-8139-5f72fce86cfd', '1823d05d-7ed0-452e-b3b3-6cf5e237c23b', 'Practical Performance Assessment', 'Practical Exam', 'Draft', NULL, '/uploads/assessments/1759133238060-PP_Assessment_-_Mastering_Prompt_Engineering_for_Generative_AI_Content_Creation-_v5.docx', '2025-09-29 16:07:18.099467+08', '2025-10-09 14:35:05.045727+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('bd8ad687-0d33-47b8-8da3-fb1407b5a348', '1823d05d-7ed0-452e-b3b3-6cf5e237c23b', 'Written Assessment', 'Written Exam', 'Draft', NULL, '/uploads/assessments/1759133238060-WA__SAQ__-_Mastering_Prompt_Engineering_for_Generative_AI_Content_Creation_-_v4.docx', '2025-09-29 16:07:18.099467+08', '2025-10-09 14:35:05.045727+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('678bef59-f782-4dd9-846c-e26a62018242', '811d0b9c-0d29-4cc1-8c3b-fc937ae7eb04', 'Written Assessment', 'Assignments', 'Published', NULL, '/uploads/assessments/1760580169046-WA__SAQ__-_Python_Programming_for_Finance_-_v2.docx', '2025-10-16 10:02:49.132655+08', '2025-10-16 10:02:49.132655+08');
INSERT INTO public.assessment (id, course_id, title, category, status, access_code, file_url, created_at, updated_at) VALUES ('0e163465-d0db-430c-be3e-53249e8133d7', '811d0b9c-0d29-4cc1-8c3b-fc937ae7eb04', 'Practical Performance Assessment', 'Assignments', 'Published', NULL, '/uploads/assessments/1760580169050-PP_Assessment_-_Python_Programming_for_Finance_-_v2.docx', '2025-10-16 10:02:49.132655+08', '2025-10-16 10:02:49.132655+08');


--
-- TOC entry 5307 (class 0 OID 16832)
-- Dependencies: 222
-- Data for Name: assessment_grade; Type: TABLE DATA; Schema: public; Owner: postgres
--

-- No data for public.assessment_grade


--
-- TOC entry 5308 (class 0 OID 16835)
-- Dependencies: 223
-- Data for Name: calendar_event; Type: TABLE DATA; Schema: public; Owner: postgres
--

-- No data for public.calendar_event


--
-- TOC entry 5310 (class 0 OID 16841)
-- Dependencies: 225
-- Data for Name: certification; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.certification (id, trainer_id, name, file_url, created_at, original_filename, developer_id) VALUES ('8251cbd3-9cd9-45d5-b7de-2fcef093baf3', '22222222-2222-4222-8222-222222222222', 'leetcode', 'http://localhost:3001/uploads/trainers/certification/1760325460910_leetcode.png', '2025-10-13 11:17:41.051595+08', 'leetcode.png', NULL);


--
-- TOC entry 5311 (class 0 OID 16849)
-- Dependencies: 226
-- Data for Name: chat_conversation; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.chat_conversation (id, user_id, created_at) VALUES ('abababab-abab-4bab-8bab-abababababab', '11111111-1111-4111-8111-111111111111', '2025-09-28 13:00:00+08');


--
-- TOC entry 5312 (class 0 OID 16854)
-- Dependencies: 227
-- Data for Name: chat_message; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.chat_message (id, conversation_id, role, text, created_at) VALUES ('cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd', 'abababab-abab-4bab-8bab-abababababab', 'user', 'How do I create a foreign key in Postgres?', '2025-09-28 13:01:00+08');
INSERT INTO public.chat_message (id, conversation_id, role, text, created_at) VALUES ('efefefef-efef-4fef-8fef-efefefefefef', 'abababab-abab-4bab-8bab-abababababab', 'model', 'Use REFERENCES on your column definition…', '2025-09-28 13:01:10+08');


--
-- TOC entry 5313 (class 0 OID 16861)
-- Dependencies: 228
-- Data for Name: course; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('51315b70-bfb5-44ff-ba7b-cc16bd3040c4', 'Creating High-Converting Email Campaigns with Mailchimp', 'https://www.tertiarycourses.com.sg/media/catalog/product/cache/1/small_image/295x180/9df78eab33525d08d6e5fb8d27136e95/w/s/wsq---creating-high-converting-email-campaigns-with-mailchimp.jpg', 'TGS-2020503109', 'Integrated Marketing', 'ICT-SNM-3006-1.1', NULL, NULL, 'ELO1: Propose email marketing strategies to address intended objectives and target customers\nELO2: Manage newsletter audience for a particular market segment\nELO3: Develop effective email campaigns to meet email campaign objective\nELO4: Automate marketing process to improve efficiency\nELO5: Evaluate the effectiveness of marketing campaigns with analytics reports', '13.5', '2.5', 'Beginner', 'Hybrid', 'WSQ', 'enrolled', 'Published', '750.00', '0.09', true, true, true, true, false, true, '2025-10-07', '2025-10-08', 'Confirmed', '/uploads/guides/1759128943361-WSQ__-_Learner_Guide_Slides_-_Creating_High-Converting_Email_Campaigns_with_Mailchimp_-_v13.pdf', '/uploads/slides/1759128943370-WSQ__-_Learner_Guide_Slides_-_Creating_High-Converting_Email_Campaigns_with_Mailchimp_-_v13.pdf', '/uploads/plans/1759128943359-Lesson_Plan_-_TGS-2020503109_-_Creating_High-Converting_Email_Campaigns_with_Mailchimp_-_v3.docx', '/uploads/plans/1759128943367-Assessment_Plan_TGS-2020503109_Creating_High-Converting_Email_Campaigns_with_Mailchimp_v4.0.docx', '/uploads/guides/1759128943365-FG_TGS-2020503109_Creating_High-Converting_Email_Campaigns_with_Mailchimp_v2.docx', '/uploads/slides/1759128943373-WSQ_-_Master_Trainer_Slides_-_Creating_High-Converting_Email_Campaigns_with_Mailchimp_-_v13.pptx', false, '2025-09-05 08:05:43.9064+08', '2025-09-29 14:55:43.387746+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('834d78e0-d30e-4007-8434-642fde67f93a', 'Data Visualisation with Tableau', 'https://www.tertiarycourses.com.sg/media/catalog/product/cache/1/small_image/295x180/9df78eab33525d08d6e5fb8d27136e95/w/s/wsq-data-visualization-tableau_2.jpg', 'TGS-2020503177', 'Data Visualization', 'ICT-DIT-3006-1.1', NULL, NULL, 'ELO1 - Learners will be able to apply basic Tableau features for displaying information.\nELO2 - Learners will be able to synthesize various plots to present data visually.\nELO3 - Learners will be able to transform data to create informative and dynamic data display.\nELO4 - Learners will be able to create dashboards and scorecards to display internal as well as external benchmark data.\nELO5 - Learners will be able to apply calculation and parameter to create interactive graphics, visuals and technical features into the data presentation.\nELO6 - Learners will be able to perform analytics to communicate limitations of data and interpretations of findings.', '13.5', '2.5', 'Beginner', 'Hybrid', 'WSQ', 'enrolled', 'Published', '750.00', '0.09', true, true, true, true, false, true, '2025-10-09', '2025-10-10', 'Confirmed', '/uploads/guides/1759129621210-WSQ_-_Learner_Guide_Slides_-_Data_Visualization_with_Tableau_-_v16.pdf', '/uploads/slides/1759129621224-WSQ_-_Learner_Guide_Slides_-_Data_Visualization_with_Tableau_-_v16.pdf', '/uploads/plans/1759129621208-Lesson_Plan__TGS-2020503177__Data_Visualisation_with_Tableau_v3.docx', '/uploads/plans/1759129621222-Assessment_Plan_TGS-2020503177_Data_Visualisation_with_Tableau_v4.docx', '/uploads/guides/1759129621219-FG_TGS-2020503177_Data_Visualisation_with_Tableau_v2.docx', '/uploads/slides/1759129621231-WSQ_-_Master_Trainer_Slides_-_Data_Visualization_with_Tableau_-_v16.pptx', false, '2025-09-05 08:05:43.9064+08', '2025-09-29 15:07:01.244898+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('71cc9df6-3487-4b52-9a73-094f33bd4634', 'Python Fundamental Course for Beginners', 'https://www.tertiarycourses.com.sg/media/catalog/product/cache/1/image/650x/040ec09b1e35df139433887a97daa66f/w/s/wsq-python-course-beginners.jpg\n', 'TGS-2019503161', 'Analytics and Computational Modelling', 'ICT-DIT-3001-1.1', NULL, NULL, 'LO1 - Learners will be able to install Python and IDE\nLO2 - Learners will be able to understand and code data types\nLO3 - Learners will be able to understand and code operators\nLO4 - Learners will be able to understand and code control structures, loop and comprehension\nLO5 - Learners will be able to understand and code functions\nLO6 - Learners will be able to install and use Python standard packages and third party package\n', '13.5', '2.5', 'Beginner', 'Hybrid', 'WSQ', 'enrolled', 'Published', '750.00', '0.09', true, true, true, true, false, true, '2025-08-30', '2025-09-06', 'Confirmed', '/uploads/guides/1759130324607-WSQ_-_Learner_Guide_Slides_-_Python_Fundamental_Course_for_Beginners_-_v19.pdf', '/uploads/slides/1759130324621-WSQ_-_Learner_Guide_Slides_-_Python_Fundamental_Course_for_Beginners_-_v19.pdf', '/uploads/plans/1759130324604-Lesson_Plan_-_TGS-2019503161_-_Python_Fundamental_Course_for_Beginners_v3.docx', '/uploads/plans/1759130324618-Assessment_Plan_TGS-2019503161_Python_Fundamental_Course_for_Beginners_v4.docx.pdf', '/uploads/guides/1759130324615-FG_TGS-2019503161_Python_Fundamental_Course_for_Beginners_v2.docx', '/uploads/slides/1759130324631-WSQ_-_Master_Trainer_Slides_-_Python_Fundamental_Course_for_Beginners_-_v19.pptx', false, '2025-09-05 08:05:43.9064+08', '2025-09-29 15:18:44.639333+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('3ac6b597-55df-4df1-ad20-d009976416c2', 'R Fundamental and Statistical Analysis for Beginners', 'https://www.tertiarycourses.com.sg/media/catalog/product/cache/1/image/650x/040ec09b1e35df139433887a97daa66f/w/s/wsq-r-programming-course.jpg', 'TGS-2019504058', 'Analytics and Computational Modelling', 'ICT-DIT-3001-1.1', NULL, NULL, 'LO1 - Leaners will be able to install R and R Studio IDE\nLO2 - Learners will be able to understand and code R data types\nLO3 - Learners will be able to understand and use R packages and datasets\nLO4 - Learners will be able to perform data visualization in R\nLO5 - Learners will be able to understand and code R programming language\nLO6 - Learners will be able to understand and use statistical methods in R\n', '13.5', '2.5', 'Beginner to Intermediate', 'Hybrid', 'WSQ', 'enrolled', 'Published', '750.00', '0.09', true, true, true, true, false, true, '2025-09-06', '2025-09-07', 'Confirmed', '/uploads/guides/1759130899467-WSQ_-_Learner_Guide_Slides_-_R_Fundamental_and_Statistical_Analysis_for_Beginners_-_v14.pptx', '/uploads/slides/1759130899471-WSQ_-_Learner_Guide_Slides_-_R_Fundamental_and_Statistical_Analysis_for_Beginners_-_v14.pptx', '/uploads/plans/1759130899466-Lesson_Plan_-_TGS-2019504058_-_R_Fundamental_and_Statistical_Analysis_for_Beginners_v3.docx', '/uploads/plans/1759130899470-Assessment_Plan_TGS-2019504058_R_Fundamental_and_Statistical_Analysis_for_Beginners_v2.docx.pdf', '/uploads/guides/1759130899469-FG_TGS-2019504058_R_Fundamental_and_Statistical_Analysis_for_Beginners_v2.docx', '/uploads/slides/1759130899473-_WSQ_-_Master_Trainer_Slides_-_R_Fundamental_and_Statistical_Analysis_for_Beginners_-_v14.pptx', false, '2025-09-05 08:05:43.9064+08', '2025-09-29 15:28:19.485869+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('497b25e3-fda4-4c84-a309-656a0433b987', 'Basic Machine Learning with ScikitLearn Course', 'https://www.tertiarycourses.com.sg/media/catalog/product/cache/1/image/650x/040ec09b1e35df139433887a97daa66f/n/i/nicf-machine-leanrning-scikit-learn.jpg', 'TGS-2019504643', ' Analytics and Computational Modelling', 'ICT-DIT-3001-1.1', NULL, NULL, 'ELO1 - Learners will be able to understand and apply machine learning concepts \nELO2 - Learners will be able to understand and apply classification algorithms\nELO3 - Learners will be able to understand and apply regression algorithms\nELO4 - Learners will be able to understand and apply clustering algorithms\nELO5 - Learners will be able to understand and apply PCA algorithms', '13.5', '2.5', 'Beginner to Intermediate', 'Hybrid', 'WSQ', 'enrolled', 'Published', '750.00', '0.09', true, true, true, true, false, true, '2025-09-26', '2025-10-03', 'Confirmed', '/uploads/guides/1759127325932-WSQ_-_Learner_Guide_Slides-_Basic_Machine_Learning_with_Scikit-Learn_Course_-_v18.pdf', '/uploads/slides/1759127325938-WSQ_-_Learner_Guide_Slides-_Basic_Machine_Learning_with_Scikit-Learn_Course_-_v18.pdf', '/uploads/plans/1759127325931-Lesson_Plan_-_TGS-2019504643_-_Basic_Machine_Learning_with_Scikit-Learn_Course_v3.docx', '/uploads/plans/1759127325937-Assessment_Plan_TGS-2019504643_Basic_Machine_Learning_with_Scikit-Learn_Course_v4.docx', '/uploads/guides/1759127325936-FG_TGS-2019504643_Basic_Machine_Learning_with_Scikit-Learn_Course_v2.docx', '/uploads/slides/1759127325941-WSQ_-_Master_Trainer_Slides_-_Basic_Machine_Learning_with_Scikit-Learn_Course_-_v18.pptx', false, '2025-09-05 08:05:43.9064+08', '2025-09-29 14:28:45.953536+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('53c1cb78-3ba0-4576-8f2b-27bd52e55317', 'Data Mining and Machine Learning Fundamentals for Beginners', 'https://www.tertiarycourses.com.sg/media/catalog/product/cache/1/image/650x/040ec09b1e35df139433887a97daa66f/d/a/data-mining-and-machine-learning-fundamentals-for-beginners.jpg', 'TGS-2020503264', 'Data Analytics', 'MED-ACE-3018-1', NULL, NULL, 'ELO1 - Learners will be able to apply data mining and machine learning principles to assess business insights.\nELO2 - Learners will be able to integrate and aggregate data from multiple datasets to build data models. \nELO3 - Learners will be able to apply predictive data modelling techniques to identify underlying trends in data.\nELO4 - Learners will be able to apply machine learning classification techniques to gain new insights from data.\nELO5 - Learners will be able to apply clustering techniques to discover data pattern and create interactive visualizations to study the data and make decision.\nELO6 - Learners will be able to develop prototype algorithms with dimension reduction techniques.\nELO7 - Learners will be able to construct association rules to Identify patterns across multiple data sets to derive insights.', '13.5', '2.5', 'Beginner', 'Hybrid', 'WSQ', 'enrolled', 'Published', '750.00', '0.09', true, true, true, true, false, true, '2025-09-20', '2025-09-21', 'Confirmed', '/uploads/guides/1759129321288-WSQ_-_Learner_Guide_Slides_-_Data_Mining_and_Machine_Learning_Fundamentals_for_Beginners_-_v16.pdf', '/uploads/slides/1759129321304-WSQ_-_Learner_Guide_Slides_-_Data_Mining_and_Machine_Learning_Fundamentals_for_Beginners_-_v16.pdf', '/uploads/plans/1759129321286-Lesson_Plan_-_TGS-2020503264_-_Data_Mining_and_Machine_Learning_Fundamentals_for_Beginners_v4.docx', '/uploads/plans/1759129321300-Assessment_Plan_TGS-2020503264_Data_Mining_and_Machine_Learning_Fundamentals_for_Beginners_v4.0.docx', '/uploads/guides/1759129321298-FG_TGS-2020503264_Data_Mining_and_Machine_Learning_Fundamentals_for_Beginners_v2.docx', '/uploads/slides/1759129321314-WSQ_-_Master_Trainer_Slides_-_Data_Mining_and_Machine_Learning_Fundamentals_for_Beginners_-_v16.pptx', false, '2025-09-05 08:05:43.9064+08', '2025-09-29 15:02:01.338341+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('a68ad2c6-7e32-4f0f-a600-644434598d24', 'Developing Advanced Machine Learning Applications with Python and Tensorflow', 'https://www.tertiarycourses.com.sg/media/catalog/product/cache/1/image/650x/040ec09b1e35df139433887a97daa66f/w/s/wsq-developing-advanced-machine-learning-applications-with--python-and-tensorflow.jpg', 'TGS-2020503207', 'Analytics and Computational Modelling', 'ICT-DIT-3001-1.1', NULL, NULL, 'ELO1 - Learners will be able to understand and code CNN models for image recognition\nELO2 - Learners will be able to diagnose overfitting issues in image recognition and propose methods to overcome the issues.\nELO3 - Learners will be able to perform functional API coding based on a selected model.\nELO4 - Learners will be able to implement transfer learning to fine tune the image recognition models. \nELO5 - Learners will be able to understand and code RNN models for text recognition', '13.5', '2.5', 'Intermediate', 'Hybrid', 'WSQ', 'enrolled', 'Published', '750.00', '0.09', true, true, true, true, false, true, '2025-09-20', '2025-09-21', 'Confirmed', '/uploads/guides/1759129877242-WSQ_-_Learner_Guide_Slides_-_Developing_Advanced_Machine_Learning_Applications_with_Python_and_Tensorflow_-_v18.pdf', '/uploads/slides/1759129877252-WSQ_-_Learner_Guide_Slides_-_Developing_Advanced_Machine_Learning_Applications_with_Python_and_Tensorflow_-_v18.pdf', '/uploads/plans/1759129877237-Lesson_Plan_-_TGS-2020503207_-_Developing_Advanced_Machine_Learning_Applications_with_Python_and_Tensorflow_-_v3.docx', '/uploads/plans/1759129877250-Assessment_Plan_TGS-2020503207_Developing_Advanced_Machine_Learning_Applications_with_Python_and_Tensorflow_v4.0.docx', '/uploads/guides/1759129877247-FG_TGS-2020503207_Developing_Advanced_Machine_Learning_Applications_with_Python_and_Tensorflow_v3.docx', '/uploads/slides/1759129877256-WSQ_-_Master_Trainer_Slides_-_Developing_Advanced_Machine_Learning_Applications_with_Python_and_Tensorflow_-_v18.pptx', false, '2025-09-05 08:05:43.9064+08', '2025-09-29 15:11:17.273094+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('8cece47b-33a9-46e6-b7c6-cf678f57d1dd', 'Advancing Your Python Coding Skills to the Next Level with Object-Oriented Programming', '/uploads/images/1759131714989-wsq-advancing-your-python-coding-skills-to-the-next-level-with-object-oriented-programming.jpg', 'TGS-2019504591', 'Analytics and Computational Modelling', 'ICT-DIT-3001-1.1', NULL, NULL, 'ELO1a - Leaners will be able to understand and code Python comprehensions\nELO1b - Leaners will be able to understand and code Python generators\nELO2 - Learners will be able to manage files and folders in Python \nELO3a - Learners will be able to understand and code OOP Classes and Objects\nELO3b - Learners will be able to understand and code OOP Inheritance\nELO4 - Learners will be able to setup and use databases in Python\nELO5 - Learners will be able to understand and code Exceptions to handle errors in Python', '13.5', '2.5', 'Intermediate', 'Hybrid', 'WSQ', 'enrolled', 'Published', '750.00', '0.09', true, true, true, true, false, true, '2025-09-13', '2025-09-14', 'Confirmed', '/uploads/guides/1759118329617-WSQ_-_Learner_Guide_Slides_-_Advancing_Your_Python_Coding_Skills_to_the_Next_Level_with_Object-Oriented_Programming_-_v17.pdf', '/uploads/slides/1759118260189-WSQ_-_Learner_Guide_Slides_-_Advancing_Your_Python_Coding_Skills_to_the_Next_Level_with_Object-Oriented_Programming_-_v17.pdf', '/uploads/plans/1759118260173-Lesson_Plan_-_TGS-2019504591_-_Advancing_Your_Python_Coding_Skills_to_the_Next_Level_with_Object-Oriented_Programming_-_v3.docx', '/uploads/plans/1759118260185-Assessment_Plan_TGS-2019504591_Advancing_Your_Python_Coding_Skills_to_the_Next_Level_with_Object-Oriented_Programming_v4.0.docx', '/uploads/guides/1759118260181-FG_TGS-2019504591_Advancing_Your_Python_Coding_Skills_to_the_Next_Level_with_Object-Oriented_Programming_v3.docx', '/uploads/slides/1759118260192-WSQ_-_Master_Trainer_Slides_-_Advancing_Your_Python_Coding__Skills_to_the_Next_Level_with_Object-Oriented_Programming_-_v17.pptx', false, '2025-09-05 08:05:43.9064+08', '2025-09-29 16:39:05.280439+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('9482c77e-2830-4646-b15e-b263d744a0fc', 'Building Your First Machine Learning Model with Python and Tensorflow', 'https://www.tertiarycourses.com.sg/media/catalog/product/cache/1/small_image/295x180/9df78eab33525d08d6e5fb8d27136e95/w/s/wsq-building-your-first-machine-learning-model-with-python-and-tensorflow.jpg', 'TGS-2019504744', 'Analytics and Computational Modelling', 'ICT-DIT-3001-1.1', NULL, NULL, 'ELO1 - Learners will be able to install Tensorflow and Keras Deep Learning framework\nELO2 - Learners will be able to understand and code Neural Network models for Regression\nELO3 - Learners will be able to understand and code Neural Network models for Classification\nELO4 - Learners will be able to understand and code Convolutional Neural Network models for Image Classification\nELO5 - Learners will be able to understand and use pre-trained models for transfer learning', '13.5', '2.5', 'Beginner to Intermediate', 'Hybrid', 'WSQ', 'enrolled', 'Published', '750.00', '0.09', true, true, true, true, false, true, '2025-10-11', '2025-10-12', 'Confirmed', '/uploads/guides/1759128319095-WSQ_-_Learner_Guide_Slides_-_Building_Your_First_Machine_Learning_Model_with_Python_and_Tensorflow_-_v24.pdf', '/uploads/slides/1759128319112-WSQ_-_Learner_Guide_Slides_-_Building_Your_First_Machine_Learning_Model_with_Python_and_Tensorflow_-_v24.pdf', '/uploads/plans/1759128319094-Lesson_Plan_-_TGS-2019504744_-_Building_Your_First_Machine_Learning_Model_with_Python_and_Tensorflow_-_v3.docx', '/uploads/plans/1759128319109-Assessment_Plan_TGS-2019504744_Building_Your_First_Machine_Learning_Model_with_Python_and_Tensorflow_v4.0.docx', '/uploads/guides/1759128319106-FG_TGS-2019504744_Building_Your_First_Machine_Learning_Model_with_Python_and_Tensorflow_v3.docx.docx', '/uploads/slides/1759128319123-WSQ_-_Master_Trainer_Slides_-_Building_Your_First_Machine_Learning_Model_with_Python_and_Tensorflow_-_v24.pptx', false, '2025-09-05 08:05:43.9064+08', '2025-10-01 13:56:31.505752+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('1823d05d-7ed0-452e-b3b3-6cf5e237c23b', 'Mastering Prompt Engineering for Generative AI Content Creation', '/uploads/images/1759133237313-wsq-mastering-prompt-engineering-for-generative-ai-content-creation.jpg', 'TGS-2023036153', 'Content Strategy', 'ICT-SNM-4004-1.1', NULL, NULL, 'LO1 - Conceptualize content ideas with prompt engineering to meet marketing objectives and map out digital storyboards as part of a content strategy.\nLO2 - Identify content requirements with prompt engineering based on evaluation of customers and potential customer preferences and determine frequency of delivering marketing content.\nLO3 - Determine types and styles of content to be delivered to customers with prompt engineering and decide on modes and processes for distributing content.\nLO4 - Develop guidelines for content strategy execution using appropriate modes of content delivery for marketing.', '15', '3', NULL, 'Physical', 'WSQ', NULL, NULL, '800.00', '7.00', false, false, false, false, false, false, NULL, NULL, NULL, '/uploads/guides/1759133237314-WSQ_-_Learner_Guide_Slides_-_Mastering_Prompt_Engineering_for_Generative_AI_Content_Creation_-_v15.pptx', '/uploads/slides/1759133237586-WSQ_-_Learner_Guide_Slides_-_Mastering_Prompt_Engineering_for_Generative_AI_Content_Creation_-_v15.pptx', '/uploads/plans/1759133237313-Lesson_Plan_TGS-2023036153_Mastering_Prompt_Engineering_for_Generative_AI_Content_Creation_v3.docx', '/uploads/plans/1759133237581-Assessment_Plan_TGS-2023036153_Mastering_Prompt_Engineering_for_Generative_AI_Content_Creation_v4.0.docx', '/uploads/guides/1759133237581-FG_TGS-2023036153_Mastering_Prompt_Engineering_for_Generative_AI_Content_Creation_v2.docx', '/uploads/slides/1759133237819-WSQ_-_Master_Trainer_Slides_-_Mastering_Prompt_Engineering_for_Generative_AI_Content_Creation_-_v15.pptx', false, '2025-09-29 16:07:18.099467+08', '2025-10-09 14:35:05.045727+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('811d0b9c-0d29-4cc1-8c3b-fc937ae7eb04', 'Python Programming for Finance', '/uploads/images/1760580168763-wsq-python-programming-for-finance.jpg', 'TGS-2022014980', 'Programming and Coding', 'ACC-DIT-3018-1.1', NULL, NULL, '- Apply Python programming to meet business requirements\n- Code data types and operators.\n- Organize codes using conditional and loop for problem-solving\n- Code Python functions and scripts for business use cases\n- Code import and prepare finance data using Python Pandas package\n- Test Python codes with aggregation and visualization\n- Improve and document Python codes to analyse finance data', '21', '3', NULL, 'Hybrid', 'WSQ', NULL, NULL, NULL, NULL, false, false, false, false, false, false, NULL, NULL, NULL, '/uploads/guides/1760580168773-WSQ_-_Learner_Guide_Slides_-_Python_Programming_for_Finance_-_v11.pdf', '/uploads/slides/1760580168844-WSQ_-_Learner_Guide_Slides_-_Python_Programming_for_Finance_-_v11.pdf', '/uploads/plans/1760580168765-Lesson_Plan_-_TGS-2022014980_-_Python_Programming_for_Finance_v2.docx', '/uploads/plans/1760580168840-Assessment_Plan_TGS-2022014980_Python_Programming_for_Finance_v3.0.docx', '/uploads/guides/1760580168838-FG_TGS-2022014980_Python_Programming_for_Finance_v1.docx', '/uploads/slides/1760580168897-WSQ_-_Master_Trainer_Slides_-_Python_Programming_for_Finance_-_v11.pptx', false, '2025-10-16 10:02:49.132655+08', '2025-10-16 10:02:49.132655+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('e396ab87-4cb6-4fb7-be13-dec77bade7c1', 'Image and Video Processing with OpenCV', '/uploads/images/1760669486150-wsq-opencv-image-processing.jpg', 'TGS-2020505925', 'Computer Vision Technology', 'ICT-DIT-4022-1.1', NULL, NULL, 'Learners will be able to understand basic vision systems concepts and applications\nLearners will be able to apply image processing with OpenCV\nLearners will be able to implement feature extraction with OpenCV \nLearners will be able to integrate machine-learning based computer vision to OpenCV\nLearners will be able to implement video analytics algorithms with OpenCV \nLearners will be able to evaluate edge vs cloud-based computer vision systems', '7.5', '2.5', NULL, 'Hybrid', 'WSQ', NULL, NULL, NULL, NULL, false, false, false, false, false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, '2025-10-17 10:51:26.2472+08', '2025-10-17 10:51:26.2472+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('063b55ab-0a2c-4460-8cab-63cb65000557', 'Tax Computations for Individuals and Organizations', NULL, 'TGS-2025054485', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, false, false, false, false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, '2025-10-29 10:35:19.477575+08', '2025-10-29 10:35:19.477575+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('e37c181e-98dd-4227-a804-336e2159c2ff', 'Build and Deploy Agentic AI Apps with CrewAI, Autogen, ADK and Streamlit', 'https://picsum.photos/seed/course_1761724689198/400/225', 'TGS-2025059028', 'Temp Title', 'Temp code', NULL, NULL, NULL, '20', '4', NULL, 'Hybrid', 'WSQ', NULL, NULL, NULL, NULL, false, false, false, false, false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, '2025-10-29 15:59:50.64583+08', '2025-10-29 15:59:50.64583+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('d4568126-82ec-422f-be7f-26a1855c7bc5', 'Data Storytelling and Visualisation for Finance Services', 'https://picsum.photos/seed/course_1761791747186/400/225', 'TGS-2022602057', 'Financial Services Skills Framework', 'FSE-DAT-5020-1.1', NULL, NULL, NULL, '12', '4', NULL, 'Hybrid', 'IBF', NULL, NULL, NULL, NULL, false, false, false, false, false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, '2025-10-30 10:39:32.025793+08', '2025-10-30 10:39:32.025793+08');
INSERT INTO public.course (id, title, image_url, course_code, tsc_title, tsc_code, tsc_knowledge, tsc_abilities, learning_outcomes, training_hours, assessment_hours, difficulty, mode_of_learning, course_type, enrollment_status, status, course_fee, tax_percent, is_wsq_funded, is_skills_future_eligible, is_psea_eligible, is_mces_eligible, is_ibf_funded, is_utap_eligible, start_date, end_date, class_status, learner_guide_url, slides_url, lesson_plan_url, assessment_plan_url, facilitator_guide_url, trainer_slides_url, is_gamified, created_at, updated_at) VALUES ('21c71128-32ed-4768-a837-b379c247ec5c', 'Financial Data Mining and Modeling with R', 'https://picsum.photos/seed/course_1761795233556/400/225', 'TGS-2023017892', 'Temp Title', 'Temp code', NULL, NULL, NULL, '20', '4', NULL, 'Hybrid', 'IBF', NULL, NULL, NULL, NULL, false, false, false, false, false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, '2025-10-30 11:35:40.857719+08', '2025-10-30 11:35:40.857719+08');


--
-- TOC entry 5314 (class 0 OID 16882)
-- Dependencies: 229
-- Data for Name: course_run; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc13', 'e396ab87-4cb6-4fb7-be13-dec77bade7c1', '1045790', 'RA477486', 'Confirmed', '2025-10-23', '2025-10-24', NULL, NULL, '2025-10-17 10:53:54.185318+08', '2025-10-17 10:54:36.257015+08', NULL, NULL);
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('a6d5d83a-150d-4719-ae47-dd2a4899dbf9', '063b55ab-0a2c-4460-8cab-63cb65000557', '1224553', 'RA663742', 'Confirmed', '2025-11-07', '2025-11-07', NULL, NULL, '2025-10-29 10:35:19.482599+08', '2025-10-29 10:35:19.482599+08', 'Jasmine Sho Choon Kim', 'jasminesho@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('58f055bf-5a83-49b0-8b37-08624dad1f81', 'e37c181e-98dd-4227-a804-336e2159c2ff', '1225737', 'RA664985', 'Confirmed', '2026-01-17', '2026-01-25', NULL, NULL, '2025-10-29 18:48:45.714751+08', '2025-10-29 18:48:45.714751+08', NULL, NULL);
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc14', '21c71128-32ed-4768-a837-b379c247ec5c', '1073686', 'RA509955', 'Confirmed', '2025-11-01', '2025-11-02', NULL, NULL, '2025-10-30 10:57:56.186739+08', '2025-10-30 15:37:22.116427+08', 'Dwight Nuwan Fonseka', 'dnuwanf@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '3ac6b597-55df-4df1-ad20-d009976416c2', '1169288', 'RA415177', 'Confirmed', '2025-09-06', '2025-09-07', 'Hybrid', '22222222-2222-4222-8222-222222222222', '2025-09-05 15:22:38.896186+08', '2025-10-30 10:10:24.038838+08', 'Wong Xin Ping', 'xinpingwong15@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('9962394d-fa09-4c59-8d4a-c6285721eb8b', 'e37c181e-98dd-4227-a804-336e2159c2ff', '1226239', 'RA665490', 'Confirmed', '2026-02-14', '2026-02-22', NULL, NULL, '2025-10-30 15:51:59.213341+08', '2025-10-30 15:51:59.213341+08', NULL, NULL);
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('e4d0ccd4-ccd7-44b0-89ab-3c2e3232b7b4', 'e37c181e-98dd-4227-a804-336e2159c2ff', '1226240', 'RA665491', 'Confirmed', '2026-02-23', '2026-02-26', NULL, NULL, '2025-10-30 15:53:14.689395+08', '2025-10-30 15:53:14.689395+08', NULL, NULL);
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('826b3f5e-c218-4c37-96c3-2234a4efe0d3', 'e37c181e-98dd-4227-a804-336e2159c2ff', '1226242', 'RA665493', 'Confirmed', '2026-03-14', '2026-03-22', NULL, NULL, '2025-10-30 15:54:23.634974+08', '2025-10-30 15:54:23.634974+08', NULL, NULL);
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('453b943a-0e96-4cd9-98e2-03a3e385499c', 'e37c181e-98dd-4227-a804-336e2159c2ff', '1226243', 'RA665495', 'Confirmed', '2026-03-23', '2026-03-26', NULL, NULL, '2025-10-30 15:55:09.988117+08', '2025-10-30 15:55:09.988117+08', NULL, NULL);
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc15', '063b55ab-0a2c-4460-8cab-63cb65000557', '1171807', 'RA611319', 'Confirmed', '2025-08-08', '2025-08-08', NULL, NULL, '2025-10-30 10:33:30.255972+08', '2025-10-30 10:33:30.255972+08', NULL, NULL);
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', '497b25e3-fda4-4c84-a309-656a0433b987', '1171678', 'RA415179', 'Confirmed', '2025-09-26', '2025-10-03', 'Hybrid', '22222222-2222-4222-8222-222222222222', '2025-09-05 15:22:38.896186+08', '2025-10-30 10:10:24.038838+08', 'Wong Xin Ping', 'xinpingwong15@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '51315b70-bfb5-44ff-ba7b-cc16bd3040c4', '1043792', 'RA415181', 'Confirmed', '2025-10-07', '2025-10-08', 'Hybrid', '22222222-2222-4222-8222-222222222222', '2025-09-05 15:22:38.896186+08', '2025-10-30 10:10:24.038838+08', 'Wong Xin Ping', 'xinpingwong15@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc4', '53c1cb78-3ba0-4576-8f2b-27bd52e55317', '1045628', 'RA415184', 'Confirmed', '2025-09-20', '2025-09-21', 'Hybrid', '22222222-2222-4222-8222-222222222222', '2025-09-05 15:22:38.896186+08', '2025-10-30 10:10:24.038838+08', 'Wong Xin Ping', 'xinpingwong15@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc5', '71cc9df6-3487-4b52-9a73-094f33bd4634', '1131729', 'RA415175', 'Confirmed', '2025-08-30', '2025-09-06', 'Hybrid', '22222222-2222-4222-8222-222222222222', '2025-09-05 15:22:38.896186+08', '2025-10-30 10:10:24.038838+08', 'Wong Xin Ping', 'xinpingwong15@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc11', '9482c77e-2830-4646-b15e-b263d744a0fc', '1171698_1', NULL, 'Pending', '2025-11-11', '2025-12-12', 'Hybrid', '22222222-2222-4222-8222-222222222222', '2025-09-05 15:22:38.896186+08', '2025-10-30 10:10:24.038838+08', 'Wong Xin Ping', 'xinpingwong15@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc8', '8cece47b-33a9-46e6-b7c6-cf678f57d1dd', '1171664', 'RA415178', 'Confirmed', '2025-09-13', '2025-09-14', 'Hybrid', '22222222-2222-4222-8222-222222222222', '2025-09-05 15:22:38.896186+08', '2025-10-30 10:10:24.038838+08', 'Wong Xin Ping', 'xinpingwong15@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc7', '834d78e0-d30e-4007-8434-642fde67f93a', '1043872', 'RA415182', 'Confirmed', '2025-11-09', '2025-11-10', 'Hybrid', '22222222-2222-4222-8222-222222222222', '2025-09-05 15:22:38.896186+08', '2025-10-30 10:10:24.038838+08', 'Wong Xin Ping', 'xinpingwong15@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc9', '9482c77e-2830-4646-b15e-b263d744a0fc', '1171698', 'RA415180', 'Confirmed', '2025-10-11', '2025-10-17', 'Hybrid', '22222222-2222-4222-8222-222222222222', '2025-09-05 15:22:38.896186+08', '2025-10-30 10:10:24.038838+08', 'Wong Xin Ping', 'xinpingwong15@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc10', 'a68ad2c6-7e32-4f0f-a600-644434598d24', '1043576', 'RA415183', 'Confirmed', '2025-10-20', '2025-11-30', 'Hybrid', '22222222-2222-4222-8222-222222222222', '2025-09-05 15:22:38.896186+08', '2025-10-30 10:15:37.988766+08', 'Wong Xin Ping', 'xinpingwong15@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccc12', '811d0b9c-0d29-4cc1-8c3b-fc937ae7eb04', '1217954', 'RA477574', 'Confirmed', '2025-10-23', '2025-10-25', 'Hybrid', NULL, '2025-09-05 15:22:38.896186+08', '2025-10-30 10:17:27.339727+08', 'Dr. Alvin Ang ', 'alvinang8888@gmail.com');
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('40bcaff1-24a2-4edc-a4bc-4c6a60ebd00a', 'e37c181e-98dd-4227-a804-336e2159c2ff', '1225939', 'RA665185', 'Confirmed', '2026-01-26', '2026-01-29', NULL, NULL, '2025-10-30 10:33:30.255972+08', '2025-10-30 10:33:30.255972+08', NULL, NULL);
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('eace8990-97e7-42c2-8435-d8f799f1058f', 'd4568126-82ec-422f-be7f-26a1855c7bc5', '1225950', 'RA665200', 'Confirmed', '2026-04-09', '2026-04-10', NULL, NULL, '2025-10-30 10:51:18.940057+08', '2025-10-30 10:51:18.940057+08', NULL, NULL);
INSERT INTO public.course_run (id, course_id, course_run_id, digital_attendance_id, class_status, start_date, end_date, mode_of_learning, assigned_trainer_id, created_at, updated_at, assigned_trainer_name, assigned_trainer_email) VALUES ('8e5cd336-1c91-4991-a1eb-b60034e283da', 'd4568126-82ec-422f-be7f-26a1855c7bc5', '1225957', 'RA665206', 'Confirmed', '2026-04-25', '2026-04-26', NULL, NULL, '2025-10-30 10:57:56.186739+08', '2025-10-30 10:57:56.186739+08', NULL, NULL);


--
-- TOC entry 5315 (class 0 OID 16892)
-- Dependencies: 230
-- Data for Name: course_run_assessment; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('0976c78b-1562-4762-ab7c-7f8519a985a4', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc8', '6dbda35c-e560-4b26-838d-3f66cad468cf', false, '2025-09-29 11:55:10.185167+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('86ff92bb-86ef-48ed-a4ca-c159427f6fe7', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc8', '971d22cf-6b2b-4de8-905a-046ab7df75d9', false, '2025-09-29 11:55:10.185167+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('a4e1208a-25d7-4466-987b-d625c9f15c13', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', '028a5278-36b5-4ada-b88e-e7a23fb09e30', false, '2025-09-29 14:28:45.953536+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('eb5713f5-de96-4ee9-8b6e-b5157480dfd3', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '2d3447fc-6abf-471c-9914-a4bb53c3dd0a', false, '2025-09-29 14:55:43.387746+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('c8df0ea3-98e5-47ea-aab7-85f0e0539c29', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '175926f4-450f-4933-b419-e6d339a618eb', false, '2025-09-29 14:55:43.387746+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('7e438f9e-6ca1-4125-9085-4c9c8e7ae336', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'b8180ae3-7c74-4cf1-9724-325e509305fd', false, '2025-09-29 14:55:43.387746+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('26d8a484-b46c-432a-9827-31095176fe7a', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4', 'eb65fcb5-1a78-4fc6-9e9f-04e343799dea', false, '2025-09-29 15:02:01.338341+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('3a335cc1-5f37-47be-87fa-0fdce0b76bb7', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4', 'aecc3836-27a3-44cc-8056-3ed892d1020e', false, '2025-09-29 15:02:01.338341+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('98f76cad-07f8-43c1-8b99-c26ec18a43be', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc7', 'e72dc913-59a8-47af-8889-a6d9bce7da4b', false, '2025-09-29 15:07:01.244898+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('4de81ec8-a953-4222-a075-001cba44541d', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc7', 'dcf201ce-1f2b-4b7d-b089-49c84bd7d584', false, '2025-09-29 15:07:01.244898+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('70ef3447-60a9-4a44-a7eb-cdf7ce4ee203', 'cccccccc-cccc-4ccc-8ccc-cccccccccc10', '2bc4cfbe-1cc6-4369-b8b8-2fa921bec8a6', false, '2025-09-29 15:11:17.273094+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('485473de-96d7-448e-9697-3940593dcb17', 'cccccccc-cccc-4ccc-8ccc-cccccccccc10', '67c2f4f9-c950-4424-bd8c-6f63bb1dfb17', false, '2025-09-29 15:11:17.273094+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('34e391eb-f2e7-40ef-8e21-ff2def5b44ab', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5', 'bfff7712-cff8-44cb-b050-edff18a568d4', false, '2025-09-29 15:18:44.639333+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('73d78a8a-c71a-4a7a-b3d1-645c2e3d220d', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'e2b532f5-efa8-4cfc-ab48-e5150437bdfa', false, '2025-09-29 15:28:19.485869+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('7238f246-8c30-4a1f-8913-a10b1c3d3254', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'b3c509c2-72d9-4074-b38d-25bec7b53ec9', true, '2025-09-30 16:41:29.104379+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('6155e74e-d0e3-4863-81c0-9bf613543f0d', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'dcb84e33-bd3c-46a7-8645-6985062a88c9', false, '2025-10-01 13:52:15.852606+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('a215f12b-b2ed-40b4-9cf0-4d135ab49613', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9', '2e1a95e5-b2b3-4329-a411-53ffba9010e1', false, '2025-10-06 09:43:34.569449+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('959b7f23-2850-49fb-99f5-352e72b89111', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9', 'd8ecfc01-974a-4a91-9251-c1cb0e3ced8d', true, '2025-10-06 09:43:35.11309+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('b688fffa-037c-4249-88da-a3cf94f60261', 'cccccccc-cccc-4ccc-8ccc-cccccccccc11', 'd8ecfc01-974a-4a91-9251-c1cb0e3ced8d', false, '2025-10-13 11:18:41.131396+08');
INSERT INTO public.course_run_assessment (id, course_run_id, assessment_id, published, published_at) VALUES ('cdf95941-3520-41c1-86eb-783f4c418399', 'cccccccc-cccc-4ccc-8ccc-cccccccccc11', '2e1a95e5-b2b3-4329-a411-53ffba9010e1', true, '2025-10-13 11:18:42.278421+08');


--
-- TOC entry 5316 (class 0 OID 16897)
-- Dependencies: 231
-- Data for Name: developer_profile; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.developer_profile (user_id, tel, developer_type, cv_url, linkedin_url, gender, qualifications, education, areas_of_specialty, cv_original_filename) VALUES ('44444444-4444-4444-8444-444444444444', '87180288', 'DACE', 'http://localhost:3001/uploads/developer/cv/1759717039391_Liu_Zhen_Resume.pdf', 'www.linkedin.com/in/liu-zhen-lz', 'Female', '["DACE"]', 'Master', '["Infocomm Technology"]', 'Liu_Zhen_Resume.pdf');


--
-- TOC entry 5317 (class 0 OID 16905)
-- Dependencies: 232
-- Data for Name: enrollment; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, course_sponsorship, enrolment_date, created_at, updated_at, certificate) VALUES ('99999999-9999-4999-8999-999999999903', '11111111-1111-4111-8111-111111111113', '51315b70-bfb5-44ff-ba7b-cc16bd3040c4', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '0.00', 'Paid', 'Pending', 'Self-Sponsored', NULL, '2025-09-04 15:22:38.896186+08', '2025-09-04 15:22:38.896186+08', NULL);
INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, course_sponsorship, enrolment_date, created_at, updated_at, certificate) VALUES ('99999999-9999-4999-8999-999999999904', '11111111-1111-4111-8111-111111111113', '53c1cb78-3ba0-4576-8f2b-27bd52e55317', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4', '0.00', 'Paid', 'Pending', 'Self-Sponsored', NULL, '2025-09-04 15:22:38.896186+08', '2025-09-04 15:22:38.896186+08', NULL);
INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, course_sponsorship, enrolment_date, created_at, updated_at, certificate) VALUES ('99999999-9999-4999-8999-999999999905', '11111111-1111-4111-8111-111111111113', '71cc9df6-3487-4b52-9a73-094f33bd4634', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5', '0.00', 'Paid', 'Pending', 'Self-Sponsored', NULL, '2025-09-04 15:22:38.896186+08', '2025-09-04 15:22:38.896186+08', NULL);
INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, course_sponsorship, enrolment_date, created_at, updated_at, certificate) VALUES ('99999999-9999-4999-8999-999999999907', '11111111-1111-4111-8111-111111111113', '834d78e0-d30e-4007-8434-642fde67f93a', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc7', '0.00', 'Paid', 'Pending', 'Self-Sponsored', NULL, '2025-09-04 15:22:38.896186+08', '2025-09-04 15:22:38.896186+08', NULL);
INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, course_sponsorship, enrolment_date, created_at, updated_at, certificate) VALUES ('99999999-9999-4999-8999-999999999911', '11111111-1111-4111-8111-111111111111', '9482c77e-2830-4646-b15e-b263d744a0fc', 'cccccccc-cccc-4ccc-8ccc-cccccccccc11', '12.50', NULL, 'Pending', NULL, NULL, '2025-09-04 15:22:38.896186+08', '2025-10-02 09:20:10.088695+08', NULL);
INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, course_sponsorship, enrolment_date, created_at, updated_at, certificate) VALUES ('99999999-9999-4999-8999-999999999909', '11111111-1111-4111-8111-111111111113', '9482c77e-2830-4646-b15e-b263d744a0fc', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9', '12.50', 'Paid', 'Pending', 'Self-Sponsored', NULL, '2025-09-04 15:22:38.896186+08', '2025-10-02 09:38:20.661484+08', NULL);
INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, course_sponsorship, enrolment_date, created_at, updated_at, certificate) VALUES ('99999999-9999-4999-8999-999999999908', '11111111-1111-4111-8111-111111111113', '8cece47b-33a9-46e6-b7c6-cf678f57d1dd', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc8', '10.00', 'Paid', 'Pending', 'Self-Sponsored', NULL, '2025-09-04 15:22:38.896186+08', '2025-10-02 09:38:32.917788+08', NULL);
INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, course_sponsorship, enrolment_date, created_at, updated_at, certificate) VALUES ('99999999-9999-4999-8999-999999999901', '11111111-1111-4111-8111-111111111113', '3ac6b597-55df-4df1-ad20-d009976416c2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '6.30', 'Paid', 'Pending', 'Self-Sponsored', NULL, '2025-08-04 15:22:38.896186+08', '2025-10-03 17:04:42.268006+08', NULL);
INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, course_sponsorship, enrolment_date, created_at, updated_at, certificate) VALUES ('99999999-9999-4999-8999-999999999910', '11111111-1111-4111-8111-111111111113', 'a68ad2c6-7e32-4f0f-a600-644434598d24', 'cccccccc-cccc-4ccc-8ccc-cccccccccc10', '0.00', 'Paid', 'Pending', 'Self-Sponsored', NULL, '2025-09-04 15:22:38.896186+08', '2025-10-06 11:18:25.579138+08', NULL);
INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, course_sponsorship, enrolment_date, created_at, updated_at, certificate) VALUES ('99999999-9999-4999-8999-999999999902', '11111111-1111-4111-8111-111111111113', '497b25e3-fda4-4c84-a309-656a0433b987', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', '0.00', 'Paid', 'Pending', 'Self-Sponsored', NULL, '2025-08-04 15:22:38.896186+08', '2025-10-06 11:33:37.921323+08', NULL);
INSERT INTO public.enrollment (id, user_id, course_id, course_run_id, progress_percent, payment_status, assessment_status, course_sponsorship, enrolment_date, created_at, updated_at, certificate) VALUES ('99999999-9999-4999-8999-999999999912', '11111111-1111-4111-8111-111111111111', '9482c77e-2830-4646-b15e-b263d744a0fc', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9', '18.80', NULL, 'Pending', NULL, NULL, '2025-09-04 15:22:38.896186+08', '2026-01-20 23:01:32.364804+08', NULL);


--
-- TOC entry 5318 (class 0 OID 16916)
-- Dependencies: 233
-- Data for Name: job_posting; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.job_posting (id, title, company, location, salary_min, salary_max, area, description, url, created_at, updated_at) VALUES ('78787878-aaaa-4bbb-8ccc-121212121212', 'Junior Backend Developer', 'TechCo', 'Singapore', '4500.00', '6500.00', 'Backend', 'Build APIs with Node/Go, Postgres', 'https://jobs.example.com/techco/backend', '2025-09-04 15:22:38.896186+08', '2025-09-04 15:22:38.896186+08');


--
-- TOC entry 5319 (class 0 OID 16927)
-- Dependencies: 234
-- Data for Name: learner_profile; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.learner_profile (user_id, tel, nric, gender, company, employment_status, nationality, ethnicity, dob, invoice_url, receipt_url, pro_forma_url) VALUES ('11111111-1111-4111-8111-111111111112', '83792199', 'M0139236P', 'Female', 'Tertiary Infotech', 'Employed', 'Non Citizen', 'Others', '2004-05-09', '/mock-invoice.pdf', '/mock-receipt.pdf', '/mock-pro-forma-invoice.pdf');
INSERT INTO public.learner_profile (user_id, tel, nric, gender, company, employment_status, nationality, ethnicity, dob, invoice_url, receipt_url, pro_forma_url) VALUES ('11111111-1111-4111-8111-111111111111', '90814263', 'T0102342J', 'Male', 'Tertiary Infotech', 'Looking for Job', 'Singaporean', 'Chinese', '2001-03-01', '/mock-invoice.pdf', '/mock-receipt.pdf', '/mock-pro-forma-invoice.pdf');
INSERT INTO public.learner_profile (user_id, tel, nric, gender, company, employment_status, nationality, ethnicity, dob, invoice_url, receipt_url, pro_forma_url) VALUES ('11111111-1111-4111-8111-111111111113', '89104951', 'M0889346L', 'Prefer not to say', 'Tertiary Infotech', 'Looking for Job', 'Non Citizen', 'Others', '2004-11-26', NULL, NULL, NULL);


--
-- TOC entry 5320 (class 0 OID 16932)
-- Dependencies: 235
-- Data for Name: learning_unit; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('6bf6ca5c-1639-4d46-97c3-b190be7b0bfe', '9482c77e-2830-4646-b15e-b263d744a0fc', 'LU1 Introduction to Deep Learning and Keras', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('32fbe105-c616-4c39-820a-6afb5f888eca', '9482c77e-2830-4646-b15e-b263d744a0fc', 'LU2 Introduction to Neural Network', '2');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('c73d6bc4-e8e2-4f10-a039-3e9ac4f4ddd2', '9482c77e-2830-4646-b15e-b263d744a0fc', 'LU3 Classification with Neural Network', '3');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('58047ff1-03a8-4ed6-b310-9fc8bd1e34f5', '9482c77e-2830-4646-b15e-b263d744a0fc', 'LU4: Image Classification with Convolutional Neural Network (CNN)', '4');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('f95f919a-6269-4756-bc35-a08a1d6d45fb', '9482c77e-2830-4646-b15e-b263d744a0fc', 'LU5 Transfer Learning with Pre-trained Models', '5');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('2a030075-bcef-40c3-9b98-569db686cd79', '1823d05d-7ed0-452e-b3b3-6cf5e237c23b', 'Prompt Engineering Principles and Tactics', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('88b9a228-0e1b-4205-9f5a-25480d229a5e', '1823d05d-7ed0-452e-b3b3-6cf5e237c23b', 'Market Research Using Prompt Engineering', '2');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('a8f1fef5-cb77-4b65-87a3-e4d7de2909db', '1823d05d-7ed0-452e-b3b3-6cf5e237c23b', 'Content Creation Using Prompt Engineering', '3');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('ccf2bd0f-b4d3-43ad-874b-303350ad432e', '1823d05d-7ed0-452e-b3b3-6cf5e237c23b', 'Content Strategy Guidelines and Ethical Considerations of Using ChatGPT', '4');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('fc5519f1-0c9e-46b6-872b-6a2acdcccc8b', '811d0b9c-0d29-4cc1-8c3b-fc937ae7eb04', 'Topic 1 Introduction to Python Programming', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('c8f00292-e11c-49ea-9e06-97c3b5821d2b', '811d0b9c-0d29-4cc1-8c3b-fc937ae7eb04', 'Topic 2: Data Types and Operators', '2');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('40e35052-a6af-41f3-ae69-e6b21b0cad07', '811d0b9c-0d29-4cc1-8c3b-fc937ae7eb04', 'Topic 3 Problem Solving with Control Structures', '3');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('5084ad59-e74b-416d-b96b-a5cb316562ea', '811d0b9c-0d29-4cc1-8c3b-fc937ae7eb04', 'Topic 4 Scripting with Function and Lambda', '4');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('7d2dc532-7cfe-4425-a459-4e30a91315ed', '811d0b9c-0d29-4cc1-8c3b-fc937ae7eb04', 'Topic 5 Import and Process Finance Data', '5');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('dd73458b-8ba3-40a5-b3f3-c56f659d732f', '811d0b9c-0d29-4cc1-8c3b-fc937ae7eb04', 'Topic 6 Aggregate and Visualize Finance Data', '6');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('c5be2e8c-bd6f-4a60-9814-88d4528c56d3', '811d0b9c-0d29-4cc1-8c3b-fc937ae7eb04', 'Topic 7 Analyze Finance Data', '7');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('d0b35581-32a3-40d7-a0f8-45b99c698923', 'e396ab87-4cb6-4fb7-be13-dec77bade7c1', 'Overview of Computer Vision', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('2339537f-1186-4edf-abc3-308e4a58e1b4', '497b25e3-fda4-4c84-a309-656a0433b987', 'LU1 – Overview of Machine Learning and Scikit Learn', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('d50b86d1-c6a3-4738-aec9-ee8b81daa0d0', '497b25e3-fda4-4c84-a309-656a0433b987', 'LU2 – Classification', '2');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('f952a60a-145d-44f2-b5f8-0f03138cc4e8', '497b25e3-fda4-4c84-a309-656a0433b987', 'LU3 – Regression', '3');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('3ca98ebd-e07c-4456-8eba-6e5b4ed4710e', '497b25e3-fda4-4c84-a309-656a0433b987', 'LU4 – Clustering', '4');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('ef38343e-061b-4cb7-adf6-118d3d805413', '497b25e3-fda4-4c84-a309-656a0433b987', 'LU5 – Principal Component Analysis', '5');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('d5c3b4b8-6de5-4d1a-a07a-b87ff93d7a3e', '51315b70-bfb5-44ff-ba7b-cc16bd3040c4', 'LU1: Overview of Email Campaign Marketing', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('0a844ef6-be7c-454e-970b-1fb47837f833', '51315b70-bfb5-44ff-ba7b-cc16bd3040c4', 'LU2: Create a Marketing Plan with Targeted Audience', '2');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('42126147-0d42-493e-b5b8-a6430475e8c9', '51315b70-bfb5-44ff-ba7b-cc16bd3040c4', 'LU3: Setup Email Campaign', '3');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('6e6641c5-7f1a-40ba-af41-13da3381493b', '51315b70-bfb5-44ff-ba7b-cc16bd3040c4', 'LU4 Automate Marketing Process', '4');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('534f4abe-d17a-4854-9166-2830d2c17342', '51315b70-bfb5-44ff-ba7b-cc16bd3040c4', 'LU5: Campaign Reports', '5');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('1ffc3d73-c6d5-4f4a-b820-f0f8c20bcc86', '53c1cb78-3ba0-4576-8f2b-27bd52e55317', 'LU1: Overview of Data Mining and Machine Learning', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('40db574c-e79e-46e4-aa62-5382d05ad5e9', '53c1cb78-3ba0-4576-8f2b-27bd52e55317', 'LU2: Data Preparation', '2');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('f9653cf6-e3b9-44e5-ad19-a15138ee24be', '53c1cb78-3ba0-4576-8f2b-27bd52e55317', 'LU3: Regression', '3');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('80a9b07a-d041-49af-85ac-eb44b4e9238e', '53c1cb78-3ba0-4576-8f2b-27bd52e55317', 'LU4 Classification', '4');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('e733a10c-ad64-46c9-85eb-6b224f2205e0', '53c1cb78-3ba0-4576-8f2b-27bd52e55317', 'LU5: Clustering', '5');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('7089ffdd-9688-47c8-9c9a-4014682de21e', '53c1cb78-3ba0-4576-8f2b-27bd52e55317', 'LU6: Dimension Reduction', '6');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('3cd838b4-5cb5-4c42-9ae9-843ec7decb64', '53c1cb78-3ba0-4576-8f2b-27bd52e55317', 'LU7: Association Analysis', '7');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('58605b9f-2fff-4da5-8ce6-d2b30a57a6d4', '834d78e0-d30e-4007-8434-642fde67f93a', 'LU1: Basic Tableau Features', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('7d786561-95fd-4554-a1f7-5d422fe66036', '834d78e0-d30e-4007-8434-642fde67f93a', 'LU2: Data Visualization', '2');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('0458e47c-68c9-454f-813a-5a016d3a0829', '834d78e0-d30e-4007-8434-642fde67f93a', 'LU3: Data Transformation', '3');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('1194936d-f216-4649-8ffe-3b6a558f641c', '834d78e0-d30e-4007-8434-642fde67f93a', 'LU4 Dashboard and Story', '4');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('81719f52-6837-4a91-a413-a21c6b117b4e', '834d78e0-d30e-4007-8434-642fde67f93a', 'LU5: Calculation & Parameter', '5');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('367280ae-7d78-4b24-84ed-488401b3c291', '834d78e0-d30e-4007-8434-642fde67f93a', 'LU6: Analytics', '6');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('0e3304ee-a6a7-4822-9d0c-523c09a62004', 'a68ad2c6-7e32-4f0f-a600-644434598d24', 'LU 1 Image Recognition with CNN', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('39e73ede-1775-4cf6-95ac-bf77453bf238', 'a68ad2c6-7e32-4f0f-a600-644434598d24', 'LU 2 Overfitting for Small Datasets', '2');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('445f12b2-0363-4b67-ba1f-75bd77646cd0', 'a68ad2c6-7e32-4f0f-a600-644434598d24', 'LU 3 Functional Keras API', '3');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('b2daeb7e-6c2e-4909-8088-285f54af7556', 'a68ad2c6-7e32-4f0f-a600-644434598d24', 'LU 4 Transfer Learning for Small Datasets', '4');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('d7204650-edb0-4a33-b7be-84fc7d9bf53a', 'a68ad2c6-7e32-4f0f-a600-644434598d24', 'LU 5 Text Classification with RNN', '5');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('34de59de-6d6c-42bd-8c7d-f093b0202ad9', '71cc9df6-3487-4b52-9a73-094f33bd4634', 'Install Python and IDE', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('ec20b382-be15-4538-b176-be6b1148b2cc', '71cc9df6-3487-4b52-9a73-094f33bd4634', 'Understand and code data types', '2');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('4985852c-b5fc-42ac-a263-9d77e175dc81', '71cc9df6-3487-4b52-9a73-094f33bd4634', 'Understand and code operators', '3');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('b2560c4d-7fab-4e97-a829-6fcec2c5a278', '71cc9df6-3487-4b52-9a73-094f33bd4634', 'Understand and code control structures, loop and comprehension.', '4');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('61799cc5-de01-41d4-b8b0-803ce1e66bd5', '71cc9df6-3487-4b52-9a73-094f33bd4634', 'Understand and code functions', '5');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('fc4fad35-0c06-4e21-8b03-799afdb01543', '71cc9df6-3487-4b52-9a73-094f33bd4634', 'Install and use Python standard packages and third party package', '6');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('a5e70f96-efdf-47c6-8481-bf16ce89580a', '3ac6b597-55df-4df1-ad20-d009976416c2', 'Getting Started in R ', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('529ff727-84a3-4e39-9ad8-e27d2ffcf2df', '3ac6b597-55df-4df1-ad20-d009976416c2', 'Data Types', '2');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('cea33e7d-b4b7-4e8d-adec-d7b90d570ca6', '3ac6b597-55df-4df1-ad20-d009976416c2', 'R Packages & Datasets', '3');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('0eefde3c-a9a3-4119-9aab-f457272e1038', '3ac6b597-55df-4df1-ad20-d009976416c2', 'Data Visualization', '4');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('733db087-60ce-4fc4-a89d-e5046814c2de', '3ac6b597-55df-4df1-ad20-d009976416c2', 'R Programming', '5');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('913c9b02-ef28-454b-a134-b4e183120816', '3ac6b597-55df-4df1-ad20-d009976416c2', 'Statistics Analysis with R', '6');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('89982332-7495-4817-b815-c477b239983d', '8cece47b-33a9-46e6-b7c6-cf678f57d1dd', 'LU1 – Comprehensions & Generators', '1');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('f48fce53-175a-4c55-bb9d-6bbfd79086d1', '8cece47b-33a9-46e6-b7c6-cf678f57d1dd', 'LU2 – File and Directory Handling', '2');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('8ceea594-068f-4305-a8a7-170d95e4f877', '8cece47b-33a9-46e6-b7c6-cf678f57d1dd', 'LU3 – Object Oriented Programming', '3');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('216340e6-033e-40b0-a540-3462923c1428', '8cece47b-33a9-46e6-b7c6-cf678f57d1dd', 'LU4 – Database', '4');
INSERT INTO public.learning_unit (id, course_id, title, "position") VALUES ('4e9eea41-5a2a-4946-a624-19a3e02529d4', '8cece47b-33a9-46e6-b7c6-cf678f57d1dd', 'LU5 – Error Handling Using Exception', '5');


--
-- TOC entry 5321 (class 0 OID 16939)
-- Dependencies: 236
-- Data for Name: provider_admin_user; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.provider_admin_user (provider_id, user_id) VALUES ('55555555-5555-5555-8555-555555555555', '33333333-3333-4333-8333-333333333333');


--
-- TOC entry 5322 (class 0 OID 16942)
-- Dependencies: 237
-- Data for Name: ssg_claims; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.ssg_claims (id, claim_id, grant_id, enrollment_id, trainee_name, course_reference, training_partner_code, claim_status, claim_amount, submission_date, approval_date, payment_date, created_date, imported_at, raw_data) VALUES ('99999999-9999-4999-8999-999999999969', 'claim_1', 'grant_1', 'ENR-2509-107531', 'Tan Guan Hong', NULL, NULL, 'Pending', NULL, NULL, NULL, NULL, '2025-10-13 11:07:30.859681+08', '2025-10-13 11:07:30.859681+08', NULL);
INSERT INTO public.ssg_claims (id, claim_id, grant_id, enrollment_id, trainee_name, course_reference, training_partner_code, claim_status, claim_amount, submission_date, approval_date, payment_date, created_date, imported_at, raw_data) VALUES ('99999999-9999-4999-8999-999999999968', 'claim_2', 'grant_2', 'ENR-2509-107530', 'May', NULL, NULL, 'Approved', NULL, NULL, NULL, NULL, '2025-10-13 11:10:09.679795+08', '2025-10-13 11:10:09.679795+08', NULL);


--
-- TOC entry 5323 (class 0 OID 16950)
-- Dependencies: 238
-- Data for Name: ssg_enrolments; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.ssg_enrolments (id, enrolment_id, trainee_name, trainee_nric, course_title, course_reference, course_run_id, training_partner_code, enrolment_status, sponsorship_type, enrolment_date, completion_date, created_date, imported_at, raw_data) VALUES ('99999999-9999-4999-8999-999999999978', 'ENR-2509-107531', 'Tan Guan Hong', 'T0102342J', 'Building Your First Machine Learning Model with Python and Tensorflow', 'TGS-2019504744', '1171698_1', NULL, NULL, NULL, NULL, NULL, '2025-10-13 10:50:04.62835+08', '2025-10-13 10:50:04.62835+08', NULL);
INSERT INTO public.ssg_enrolments (id, enrolment_id, trainee_name, trainee_nric, course_title, course_reference, course_run_id, training_partner_code, enrolment_status, sponsorship_type, enrolment_date, completion_date, created_date, imported_at, raw_data) VALUES ('99999999-9999-4999-8999-999999999988', 'ENR-2509-107530', 'May', 'M0889346L', 'Building Your First Machine Learning Model with Python and Tensorflow', 'TGS-2019504744', '1171698_1', '201200696W-01', 'Confirmed', 'individual', NULL, NULL, '2025-10-13 10:36:48.481624+08', '2025-10-13 10:36:48.481624+08', NULL);


--
-- TOC entry 5324 (class 0 OID 16958)
-- Dependencies: 239
-- Data for Name: ssg_grants; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.ssg_grants (id, enrollment_id, grant_id, status, funding_scheme_code, funding_scheme_description, component_code, component_description, estimated_grant_amount, approved_grant_amount, created_date, imported_at, api_response) VALUES ('99999999-9999-4999-8999-999999999979', 'ENR-2509-107531', 'grant_1', 'Pending', NULL, NULL, NULL, NULL, NULL, NULL, '2025-10-13 10:49:36.682889+08', '2025-10-13 10:49:36.682889+08', NULL);
INSERT INTO public.ssg_grants (id, enrollment_id, grant_id, status, funding_scheme_code, funding_scheme_description, component_code, component_description, estimated_grant_amount, approved_grant_amount, created_date, imported_at, api_response) VALUES ('99999999-9999-4999-8999-999999999989', 'ENR-2509-107530', 'grant_2', 'Approved', NULL, NULL, NULL, NULL, NULL, NULL, '2025-10-13 10:42:24.873699+08', '2025-10-13 10:42:24.873699+08', NULL);


--
-- TOC entry 5325 (class 0 OID 16966)
-- Dependencies: 240
-- Data for Name: submission; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.submission (id, enrollment_id, assessment_id, file_name, submitted_at, file_url, grading) VALUES ('8950a14a-36cf-47da-805a-2eab4dc4bef4', '99999999-9999-4999-8999-999999999911', 'd8ecfc01-974a-4a91-9251-c1cb0e3ced8d', 'Term Paper.docx', '2025-10-06 10:11:09.113925+08', '/uploads/submissions/1759716669051_Term_Paper.docx', 'Not Yet Competent');
INSERT INTO public.submission (id, enrollment_id, assessment_id, file_name, submitted_at, file_url, grading) VALUES ('647fc433-f5ef-4361-87bf-82647ae0ea60', '99999999-9999-4999-8999-999999999912', 'd8ecfc01-974a-4a91-9251-c1cb0e3ced8d', 'cer1.docx', '2025-10-06 10:11:36.176544+08', '/uploads/submissions/1759716696045_cer1.docx', 'Competent');


--
-- TOC entry 5326 (class 0 OID 16972)
-- Dependencies: 241
-- Data for Name: subtopic; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('132461a3-7702-4572-b1bc-4e20c1e25a08', '2a030075-bcef-40c3-9b98-569db686cd79', 'Introduction to the AI and Prompt Engineering', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('c162e5f7-4073-4e47-b5be-5b06b9591a13', '2a030075-bcef-40c3-9b98-569db686cd79', 'Prompt engineering principles and tactics', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('bcec035b-1820-4ea3-b58e-0349558d2e5f', '2a030075-bcef-40c3-9b98-569db686cd79', 'Conceptualize content ideas to meet marketing objectives using Prompt Engineering (A1)', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('8b1cd334-a366-4f88-b735-996dfadcb079', '2a030075-bcef-40c3-9b98-569db686cd79', 'Map out digital storyboards as part of a content strategy (K1, A2)', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('a5f7c1ac-4b68-434a-b096-98f8f706c5c5', '88b9a228-0e1b-4205-9f5a-25480d229a5e', 'Market research techniques using Prompt Engineering ', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d2ea3317-7157-4112-a2d3-8a0255fc8ad3', '88b9a228-0e1b-4205-9f5a-25480d229a5e', 'Identify content requirements based on evaluation of customers and potential customer preferences (K2, A3)', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('9bf28e4e-9154-4256-97d9-404e288b5208', '88b9a228-0e1b-4205-9f5a-25480d229a5e', 'Determine frequency of delivering marketing content to customers (K4, A4)', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('b252e541-7a94-4a25-8fe3-71c5c7fbeefd', 'a8f1fef5-cb77-4b65-87a3-e4d7de2909db', 'Techniques for content creation using Prompt Engineering ', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('452dd866-4eb3-4750-afc0-c5064b7c77b0', 'a8f1fef5-cb77-4b65-87a3-e4d7de2909db', 'Process of developing digital storyboard with Prompt Engineering (K3)', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('60670724-1bca-4aab-83a3-a10b2d3d4329', 'a8f1fef5-cb77-4b65-87a3-e4d7de2909db', 'Determine types and styles of content to be delivered to customers (K5, A5)', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('69bf76ec-0faf-4a37-ae43-a22ea653b563', 'ccf2bd0f-b4d3-43ad-874b-303350ad432e', 'Determine modes and processes for distributing content (K6, A6)', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('1bc5cc64-a1ae-4141-8135-e3880b64e4b4', 'ccf2bd0f-b4d3-43ad-874b-303350ad432e', 'Ethical considerations and guidelines when using AI', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('41da71e3-af43-4cee-8e44-bffb402f5562', 'ccf2bd0f-b4d3-43ad-874b-303350ad432e', 'Develop guidelines for content strategy execution (A7)', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('65202591-e522-458d-a14d-c4e6d24e9d6c', 'fc5519f1-0c9e-46b6-872b-6a2acdcccc8b', 'Business requirements and objectives', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('2249d4c6-7140-43ac-9584-ad4962f70793', 'fc5519f1-0c9e-46b6-872b-6a2acdcccc8b', 'Applications of Python programming to meet business requirements', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('51a253a7-2e8e-4fd5-8743-832a70d8bb50', 'fc5519f1-0c9e-46b6-872b-6a2acdcccc8b', 'Install Python and Setup Python IDE', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('f1ee937b-5423-4006-a94c-6ea7016c0739', 'c8f00292-e11c-49ea-9e06-97c3b5821d2b', 'Data Types', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('94ee53eb-2490-4ecf-9439-6f636ba00ed0', 'c8f00292-e11c-49ea-9e06-97c3b5821d2b', 'Operators', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('e0efe7eb-b09c-4856-b72e-7201124cadc3', '40e35052-a6af-41f3-ae69-e6b21b0cad07', 'Problem solving with conditional and loop techniques', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ff3db375-dae9-4297-bd3c-70bd2feddd18', '2339537f-1186-4edf-abc3-308e4a58e1b4', 'Introduction to Machine Learning', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('665b1cc3-cd29-421d-ac0a-19c76f72f751', '2339537f-1186-4edf-abc3-308e4a58e1b4', 'Supervised vs Unsupervised Learnings', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('2aaf29be-15c5-495f-8208-d697896f7202', '2339537f-1186-4edf-abc3-308e4a58e1b4', 'Machine Learning Applications and Case Studies', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('763c2169-11b7-4be6-b707-e919043dad1c', '2339537f-1186-4edf-abc3-308e4a58e1b4', 'What is Scikit Learn', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('bec6649a-62ba-4fb2-90d3-54540974f097', '2339537f-1186-4edf-abc3-308e4a58e1b4', 'Installing Scikit-Learn', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('63ca726b-4bd2-49c2-a941-2684bef432a6', 'd50b86d1-c6a3-4738-aec9-ee8b81daa0d0', 'What is Classification', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('3d32a07f-5373-4176-b49b-0aa90c17ff43', 'd50b86d1-c6a3-4738-aec9-ee8b81daa0d0', 'Applications of Classification', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('e1aa6181-4ae9-4418-a53a-9148e55cf62e', 'd50b86d1-c6a3-4738-aec9-ee8b81daa0d0', 'Classification Algorithms', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('1697bf68-ceb1-4262-bad1-a720567d200b', 'd50b86d1-c6a3-4738-aec9-ee8b81daa0d0', 'Classification Workflow', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('0545a251-a7e6-4e1d-b38d-09ea73f3bb06', 'd50b86d1-c6a3-4738-aec9-ee8b81daa0d0', 'Confusion Matrix', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('c8e49eef-0b07-4bfe-8bcf-21adda2b444b', 'd50b86d1-c6a3-4738-aec9-ee8b81daa0d0', 'Classification Performance Evaluation', '6');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('f46d36ee-17af-4f0e-9d9a-e5b38ded2f8c', 'f952a60a-145d-44f2-b5f8-0f03138cc4e8', 'What is Regression', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('1e0dbe94-d799-4a4e-947b-1324bf8800c0', 'f952a60a-145d-44f2-b5f8-0f03138cc4e8', 'Applications of Regression', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('37402848-03e2-48b2-b5f2-391e5ea39086', 'f952a60a-145d-44f2-b5f8-0f03138cc4e8', 'Regression Algorithms', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('df746c43-137c-486c-87e0-c1b542845e44', 'f952a60a-145d-44f2-b5f8-0f03138cc4e8', 'Regression Workflow', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('bfdacc44-cb27-4ae6-b85c-3773be00a6d3', 'f952a60a-145d-44f2-b5f8-0f03138cc4e8', 'Regression Performance Evaluation', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('8d3c14c1-8748-4374-b0c5-e35bb3cdf754', '3ca98ebd-e07c-4456-8eba-6e5b4ed4710e', 'What is Clustering', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('e0a0980d-ea7d-419c-8bf8-18d889d71ca6', '3ca98ebd-e07c-4456-8eba-6e5b4ed4710e', 'Applications of Clustering', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('01728c75-5209-4c52-88ca-059b2170e0f6', '3ca98ebd-e07c-4456-8eba-6e5b4ed4710e', 'Clustering Algorithms', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('8487ffad-3b40-4000-87b5-5606338f6f4f', '3ca98ebd-e07c-4456-8eba-6e5b4ed4710e', 'Clustering Workflow', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('a2c91d46-8b46-4863-8b4b-302746945937', '3ca98ebd-e07c-4456-8eba-6e5b4ed4710e', 'Clustering Performance Evaluation', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('a9adb6e7-d098-4a79-9842-c65a311a0d5b', 'ef38343e-061b-4cb7-adf6-118d3d805413', 'Introduction to Principal Component Analysis (PCA)', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ed815e8f-66c5-4f9d-a84a-dffcb4cbc3f9', 'ef38343e-061b-4cb7-adf6-118d3d805413', 'Application of PCA', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('83c221f0-0114-45ff-a3d5-11d53aab7858', 'ef38343e-061b-4cb7-adf6-118d3d805413', 'PCA Workflow', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('a09efdf8-018a-497b-96a4-5996852e8846', '6bf6ca5c-1639-4d46-97c3-b190be7b0bfe', 'Machine Learning vs Deep Learning', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('2015e183-5759-4a0c-91de-981f3094abf7', '6bf6ca5c-1639-4d46-97c3-b190be7b0bfe', 'Deep Learning Methodology', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('80f30a14-720b-43e0-b06e-418b9e83e569', '6bf6ca5c-1639-4d46-97c3-b190be7b0bfe', 'Overview of Tensorflow and Keras', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('248e8487-9793-49d2-ae36-0dbe6f393e30', '6bf6ca5c-1639-4d46-97c3-b190be7b0bfe', 'Install and Run Keras', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('355314cc-00b9-4d23-921a-130ab01563c9', '32fbe105-c616-4c39-820a-6afb5f888eca', 'What is Neural Network (NN)?', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('53194fcb-d438-4ab5-b432-e14fea33deea', '32fbe105-c616-4c39-820a-6afb5f888eca', 'Loss Function and Optimizer', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('27bd26b2-91f4-438f-a003-f397fff67d04', '32fbe105-c616-4c39-820a-6afb5f888eca', 'Build a Neural Network Model for Regression', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('cead0316-c9e5-43b4-8265-2c2ebbb3f134', 'c73d6bc4-e8e2-4f10-a039-3e9ac4f4ddd2', 'One Hot Encoding and SoftMax', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('304bfc1e-d9de-4e2c-b4a3-e01cc7617feb', 'c73d6bc4-e8e2-4f10-a039-3e9ac4f4ddd2', 'Cross Entropy Loss Function', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('bc9b1a1a-ef25-45c9-9924-4cbbbdd8de49', 'c73d6bc4-e8e2-4f10-a039-3e9ac4f4ddd2', 'Build a Neural Network Model for Classification', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('577a5012-5884-4247-aeae-c84c5fff06bc', '58047ff1-03a8-4ed6-b310-9fc8bd1e34f5', 'Introduction to Convolutional Neural Network?', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('b825ffc0-49e0-4798-ac81-1a5658fb8e7a', '58047ff1-03a8-4ed6-b310-9fc8bd1e34f5', 'Image Data Generator', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('9790dbdd-6f1b-4ac1-8b87-1c80d199356d', 'd5c3b4b8-6de5-4d1a-a07a-b87ff93d7a3e', 'What is Email Marketing', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('9b223b15-0b5a-405c-a289-dc1e2ede2f01', 'd5c3b4b8-6de5-4d1a-a07a-b87ff93d7a3e', 'Email Marketing Strategies', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('8401302c-a2b7-4256-8fce-ff8cefdffb30', 'd5c3b4b8-6de5-4d1a-a07a-b87ff93d7a3e', 'Drip Campaign', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('4d972c84-c66a-4a9f-b15f-a1ab88e0e71c', 'd5c3b4b8-6de5-4d1a-a07a-b87ff93d7a3e', 'Lead Magnets', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('eba044b5-5e21-49c5-b5a7-f616d1af76c7', 'd5c3b4b8-6de5-4d1a-a07a-b87ff93d7a3e', 'Sign Up Mailchimp', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('a69468cd-eada-4c24-934e-0b1753600beb', 'd5c3b4b8-6de5-4d1a-a07a-b87ff93d7a3e', 'Create a Signup Form', '6');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('59ff81f0-02da-4813-b75c-95a8d06166b7', '0a844ef6-be7c-454e-970b-1fb47837f833', 'Types of Audience', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('76554e0b-035c-40ef-b560-f59173173ba3', '0a844ef6-be7c-454e-970b-1fb47837f833', 'Soft vs Hard Bounces', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('a82146c9-001d-4d31-8b85-eb84867cf665', '0a844ef6-be7c-454e-970b-1fb47837f833', 'Manage Tags, Groups and Segments', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('5f7e974a-b6da-4723-84b6-3e06f6c934a4', '0a844ef6-be7c-454e-970b-1fb47837f833', 'Create a Marketing Plan with Email Segmentation', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ddc69be9-7848-4dcc-9426-178585823986', '42126147-0d42-493e-b5b8-a6430475e8c9', 'Content Studio', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d983d2d0-2b75-4acb-a220-6d182f568b7d', '42126147-0d42-493e-b5b8-a6430475e8c9', 'Create Email Template', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('7f5aed9f-edb7-4a37-a5ab-3da177794ac3', '42126147-0d42-493e-b5b8-a6430475e8c9', 'Types of Templates', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('b7183606-9626-45bc-96ff-af29d33e10bd', '42126147-0d42-493e-b5b8-a6430475e8c9', 'Setup Email Campaign', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('7e1645ff-2eca-42e3-aea9-f5df272c89a1', '42126147-0d42-493e-b5b8-a6430475e8c9', 'Email Beamer', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('9796d8c4-c7c0-45f9-916d-963c9eee386f', '6e6641c5-7f1a-40ba-af41-13da3381493b', 'What is Marketing Automation', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('25e0d2df-6359-413b-b44c-2015573408ea', '6e6641c5-7f1a-40ba-af41-13da3381493b', 'Create an Automation', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('90aa4cf1-fb5d-4382-ba2c-1483c811de32', '6e6641c5-7f1a-40ba-af41-13da3381493b', 'Automation Triggers', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('1eaeab7b-c71f-44d2-bee4-51e079cb99e9', '6e6641c5-7f1a-40ba-af41-13da3381493b', 'Create Social Posts', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('6ad2f524-0074-4ecc-a3f0-c92dd4f244ca', '6e6641c5-7f1a-40ba-af41-13da3381493b', 'Automate Social Post in Emails', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('56fbb0f5-289d-490a-aa28-af9175ca0326', '534f4abe-d17a-4854-9166-2830d2c17342', 'Overview of Mailchimp Campaign Reports', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('5ea8e3e9-de04-4f50-852d-0d522f025c5e', '534f4abe-d17a-4854-9166-2830d2c17342', 'Campaign Performance Metrics', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('84129c5c-7885-49b1-afda-e61bf3b9afcd', '534f4abe-d17a-4854-9166-2830d2c17342', 'How to Improve Open and Click Rates', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('cbdd9cdb-f60d-45db-8441-768a07b1a240', '534f4abe-d17a-4854-9166-2830d2c17342', 'A/B Testing Campaigns', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('41b3037a-c4bb-4835-a8b1-db72865cf722', '1ffc3d73-c6d5-4f4a-b820-f0f8c20bcc86', 'Data Mining Process', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('44fe2e22-546f-4ba0-8093-4cb5216897fa', '1ffc3d73-c6d5-4f4a-b820-f0f8c20bcc86', 'Overview of Machine Learning', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('487649fe-f322-446b-b64c-f05cb621c72b', '1ffc3d73-c6d5-4f4a-b820-f0f8c20bcc86', 'Impact of Data Mining and ML to Access Business Insight', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('e3a77009-b704-4789-808d-8ebdc67236e6', '40db574c-e79e-46e4-aa62-5382d05ad5e9', 'Import/Export Data', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('06c37ad8-7147-476a-bb0d-9eba6046c254', '40db574c-e79e-46e4-aa62-5382d05ad5e9', 'Filter Data', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('dffefe2a-d958-4797-90bf-aaf069366495', '40db574c-e79e-46e4-aa62-5382d05ad5e9', 'Join Data', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('3ff6ee5e-495a-4830-b92a-7e0e4f4d2d61', '40db574c-e79e-46e4-aa62-5382d05ad5e9', 'Clean Data', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('c153d383-8286-4ad4-85ff-a7a831533972', '40db574c-e79e-46e4-aa62-5382d05ad5e9', 'Scale Data', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('fa05b23d-5e71-45dc-b7ca-aa7f69534c77', '40db574c-e79e-46e4-aa62-5382d05ad5e9', 'Aggregate Data', '6');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('943ba32d-916e-4c73-89e6-730f0d50082a', 'f9653cf6-e3b9-44e5-ad19-a15138ee24be', 'What is Regression', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('cca0f7df-bea4-4f33-917f-3e9ea160b3e3', 'f9653cf6-e3b9-44e5-ad19-a15138ee24be', 'Linear Regression', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('bd7bfcae-933a-412a-ac4e-441042903f86', 'f9653cf6-e3b9-44e5-ad19-a15138ee24be', 'Underfitting and Overfitting', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('bda09234-e384-477f-862b-702a81ceb121', 'f9653cf6-e3b9-44e5-ad19-a15138ee24be', 'Regularization Techniques', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('54238a27-448c-4932-91cd-1bf938f12652', '80a9b07a-d041-49af-85ac-eb44b4e9238e', 'Overview of Classification', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('6fc35908-74e2-468f-ba08-9536fb2955b7', '80a9b07a-d041-49af-85ac-eb44b4e9238e', 'Classification Algorithms', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('5c2668a4-65ca-49b4-8a00-ee5262c44f06', '80a9b07a-d041-49af-85ac-eb44b4e9238e', 'K-Fold Cross Validation', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('094336e1-fb37-45f5-998a-0a20aa6a60b5', '80a9b07a-d041-49af-85ac-eb44b4e9238e', 'Model Evaluation Metrics', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('68cf8b2a-7616-4d5d-aecd-878e7aa351f7', '80a9b07a-d041-49af-85ac-eb44b4e9238e', 'Confusion Matrix, ROC and AUC', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ca6e413c-5d4d-4b8c-8141-be7608b5c7ef', 'e733a10c-ad64-46c9-85eb-6b224f2205e0', 'Overview of Clustering', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('0d17c53b-5ca6-4694-afba-5e2a94ec4017', 'e733a10c-ad64-46c9-85eb-6b224f2205e0', 'K-Means Clustering', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('c20a1160-5ef0-4a81-9855-5f7ee2874688', 'e733a10c-ad64-46c9-85eb-6b224f2205e0', 'Silhouette Analysis', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('753e7117-aee9-4a6a-a9d6-c2e278b07518', 'e733a10c-ad64-46c9-85eb-6b224f2205e0', 'Hierarchical Clustering', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d5c6ece9-79b1-43ec-8418-db1e95b4c4ec', '7089ffdd-9688-47c8-9c9a-4014682de21e', 'Principal Component Analysis (PCA)', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('200dda70-9da9-47a8-b388-78a16ca9e0fc', '7089ffdd-9688-47c8-9c9a-4014682de21e', 'Feature Ranking', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('feae234e-0fc2-4aff-9f8d-d3b459ab0e96', '3cd838b4-5cb5-4c42-9ae9-843ec7decb64', 'Association Rules', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('a470b85c-cb1a-41bb-bf28-e55a94a65e37', '3cd838b4-5cb5-4c42-9ae9-843ec7decb64', 'Constructing Rules', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('dce9b858-e0ea-48fa-bb0f-7c825e3def16', '58605b9f-2fff-4da5-8ce6-d2b30a57a6d4', 'Overview of Tableau', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('91610bf0-4ba8-4112-a031-8c1220cefc1a', '58605b9f-2fff-4da5-8ce6-d2b30a57a6d4', 'Explore Tableau Interface', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ea0b7905-43fc-47d4-a045-e752193990dc', '58605b9f-2fff-4da5-8ce6-d2b30a57a6d4', 'Dimension and Measure', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('31a985ff-f4ef-41cf-be0c-73a9c88ca118', '58605b9f-2fff-4da5-8ce6-d2b30a57a6d4', 'Continuous and Categorical Data', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('6dc0ccb9-6411-4540-a3b5-b095ac4d4ccb', '58605b9f-2fff-4da5-8ce6-d2b30a57a6d4', 'Folder and Hierarchy', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('3216d939-9714-44ca-bec3-0e81b21a015e', '7d786561-95fd-4554-a1f7-5d422fe66036', 'Data Sources & Extract', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('0fbb9f30-e74a-47a2-b88e-e66b9aa84683', '7d786561-95fd-4554-a1f7-5d422fe66036', 'Data Join & Blending', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('65e93d04-6457-4a8e-8ac1-c1a7b18ffbd8', '7d786561-95fd-4554-a1f7-5d422fe66036', 'Scatter Plots', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('40bfe859-925f-4b8c-832b-abf111649be0', '7d786561-95fd-4554-a1f7-5d422fe66036', 'Bar Plots', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('6671d8cb-218a-4871-bf0d-501237f9cb1d', '7d786561-95fd-4554-a1f7-5d422fe66036', 'Treemap', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('a986ed97-e144-4997-bf58-47927fd209ee', '0458e47c-68c9-454f-813a-5a016d3a0829', 'Data Interpreter', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('9cddc158-dc55-478b-b10f-34f14d64980f', '0458e47c-68c9-454f-813a-5a016d3a0829', 'Split & Merge Fields', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('f4615be8-65c9-45de-aa0d-8aa2419ebb51', '0458e47c-68c9-454f-813a-5a016d3a0829', 'Pivot Data', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('fe956c00-286c-48e1-bd0b-bdff40790bc8', '0458e47c-68c9-454f-813a-5a016d3a0829', 'Filter Data', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('520e1814-4d20-4f64-9f8f-a4f4ffef2103', '0458e47c-68c9-454f-813a-5a016d3a0829', 'Organize Data by Group & Set', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('2ae666a0-74a2-47cc-9301-c2cf71e36e83', '1194936d-f216-4649-8ffe-3b6a558f641c', 'Create a Dashboard', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('caf94502-6163-4cb8-bacc-4831e0d433fb', '1194936d-f216-4649-8ffe-3b6a558f641c', 'Use Actions', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('c3bc46a4-8443-4088-af99-68a77090ea2c', '1194936d-f216-4649-8ffe-3b6a558f641c', 'Create a Story ', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('b45ed077-1e19-443f-a267-fe715031e22b', '81719f52-6837-4a91-a413-a21c6b117b4e', 'Create Calculated Field', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('21ca902c-4d30-44d9-b92f-64e3bbd79ad0', '81719f52-6837-4a91-a413-a21c6b117b4e', 'Filter By Parameter', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('f742eab7-aead-4704-89ed-c9272db340fa', '81719f52-6837-4a91-a413-a21c6b117b4e', 'Add Calculation to Parameter', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('4e27824d-ef5e-4c0a-a21a-e42bb0f78d44', '81719f52-6837-4a91-a413-a21c6b117b4e', 'Reference Line', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('f733ee36-a2eb-48a3-b9bb-cd8823da5d10', '81719f52-6837-4a91-a413-a21c6b117b4e', 'Dynamic View', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('4ce8d29f-07ce-404b-a5ac-a79d9363fa90', '367280ae-7d78-4b24-84ed-488401b3c291', 'Average Line', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('0e1bf7c7-ce7c-442d-98de-344c06e26277', '367280ae-7d78-4b24-84ed-488401b3c291', 'Trend Line', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ec3b81e3-98d8-45a7-8617-8c75572a8919', '367280ae-7d78-4b24-84ed-488401b3c291', 'Forecast', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('05f63677-3613-45eb-95d8-98f8ebb62a8f', '367280ae-7d78-4b24-84ed-488401b3c291', 'Clustering', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('7024a722-9292-4b58-b697-7b5374f93f96', '0e3304ee-a6a7-4822-9d0c-523c09a62004', 'Introduction to Convolutional Neural Network (CNN)', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('f13c7956-2973-4660-8db3-2efa1a5346e6', '0e3304ee-a6a7-4822-9d0c-523c09a62004', 'Convolution & Pooling', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('e2f36780-cf37-4c91-999b-1eb56ebb8a03', '0e3304ee-a6a7-4822-9d0c-523c09a62004', 'Build a CNN Model for Image Recognition', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d7a365cb-6525-4166-a737-a461f670d8c2', '39e73ede-1775-4cf6-95ac-bf77453bf238', 'Overfitting and Underfitting', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('bd0cc391-520e-45a0-82b2-5e1ae0a3582f', '39e73ede-1775-4cf6-95ac-bf77453bf238', 'Methods to Solve Overfitting', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('390caa26-d7d1-4b35-840c-8275949e4d16', '39e73ede-1775-4cf6-95ac-bf77453bf238', 'Small Dataset Overfitting Issue', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('8ebc1096-7344-4acc-8821-b7db95a94531', '39e73ede-1775-4cf6-95ac-bf77453bf238', 'Data Augmentation & Dropout ', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('a3c972d5-80aa-475d-9a55-006fcad31faf', '445f12b2-0363-4b67-ba1f-75bd77646cd0', 'What is Functional API', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('dc8bc66a-4d09-4091-9318-6bfa3bb51544', '445f12b2-0363-4b67-ba1f-75bd77646cd0', 'Create Sequential Model with Functional API', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('6207ef65-d9c2-4ee9-80b8-29f02c143ef2', '445f12b2-0363-4b67-ba1f-75bd77646cd0', 'Create Non-Sequential Models with Functional API', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('f02d89e1-63a4-4ea8-bfd3-61b837c2b69a', 'b2daeb7e-6c2e-4909-8088-285f54af7556', 'Introduction to Transfer Learning ', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('7e6411dc-6155-4f91-a271-7981cb137225', 'b2daeb7e-6c2e-4909-8088-285f54af7556', 'Pre-trained Models', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('789f4f30-6d12-4ede-b022-39bfb43be95f', 'b2daeb7e-6c2e-4909-8088-285f54af7556', 'Transfer Learning on Small Dataset', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('5946d67f-4acf-4881-b070-b8440f376c25', 'd7204650-edb0-4a33-b7be-84fc7d9bf53a', 'Introduction to Recurrent Neural Network (RNN)', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('613356fc-09fc-41e3-b785-69e4c579e7bd', 'd7204650-edb0-4a33-b7be-84fc7d9bf53a', 'Types of RNN Architectures', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('88969b22-4448-48ba-859f-e31b5d20a9ab', 'd7204650-edb0-4a33-b7be-84fc7d9bf53a', 'LSTM and GRU', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('fb538712-b632-4bf1-8769-e38c3f82307d', 'd7204650-edb0-4a33-b7be-84fc7d9bf53a', 'Word Embedding', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('780d473e-1d14-4988-84ac-b99da90a48c5', 'd7204650-edb0-4a33-b7be-84fc7d9bf53a', 'Build a RNN Model for Text Classification', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('47bad338-41eb-4e41-b8da-0fb654ef4374', '34de59de-6d6c-42bd-8c7d-f093b0202ad9', 'Install Python ', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('15e9c45a-e756-4923-bcd8-b8e40162687b', '34de59de-6d6c-42bd-8c7d-f093b0202ad9', 'Install Python IDE', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('2059c2b0-faae-4498-8e5a-669b87300847', '34de59de-6d6c-42bd-8c7d-f093b0202ad9', 'Code First Python Script', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('a75f01ae-20c2-4220-8b2b-f6e3ecbb40f4', '34de59de-6d6c-42bd-8c7d-f093b0202ad9', 'Use script algorithms', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('da34942c-9c3b-496b-bdbe-81e9b4d749aa', '34de59de-6d6c-42bd-8c7d-f093b0202ad9', 'Python comment', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('fefbae3a-c741-481e-9cda-eb289e4a47fc', 'ec20b382-be15-4538-b176-be6b1148b2cc', 'Number', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('844d42c5-e34a-4537-bdf4-da4327602d2f', 'ec20b382-be15-4538-b176-be6b1148b2cc', 'String', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('06517a91-f1e9-44a4-99bd-5930dd084eea', 'ec20b382-be15-4538-b176-be6b1148b2cc', 'List', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ae788dea-3f32-4618-9f24-64b078a9c34b', 'ec20b382-be15-4538-b176-be6b1148b2cc', 'Tuple', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('aae6d885-f467-4410-8732-dcbb09a9be51', 'ec20b382-be15-4538-b176-be6b1148b2cc', 'Dictionary', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('7902ea49-692d-4da6-8876-d5d75f338b6e', 'ec20b382-be15-4538-b176-be6b1148b2cc', 'How to decide data pattern', '6');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('784c9726-f33c-4630-b798-e0d9cf1e72dc', '4985852c-b5fc-42ac-a263-9d77e175dc81', 'Arithmetic Operators', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d1aa5bf7-225a-4398-83b3-baba75c63ec6', '4985852c-b5fc-42ac-a263-9d77e175dc81', 'Compound Operators', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('dd45db82-66e2-4c32-8fa2-80608f71f276', '4985852c-b5fc-42ac-a263-9d77e175dc81', 'Comparison Operators', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d05fce0d-9098-4626-bf79-c3a29e4d30fb', '4985852c-b5fc-42ac-a263-9d77e175dc81', 'Membership Operators', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('693aec30-d286-49e8-9625-b3a6bf97614f', '4985852c-b5fc-42ac-a263-9d77e175dc81', 'Logical Operators', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('b3124604-dd15-4f81-b75c-b25e0b15b90e', '4985852c-b5fc-42ac-a263-9d77e175dc81', 'Identity Operators', '6');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('18e953e4-537a-43a7-aeb3-5700d38b7053', '4985852c-b5fc-42ac-a263-9d77e175dc81', 'Assess effectiveness of operators', '7');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('f92eacd5-8850-42f9-b492-8f1628d7f5f1', 'b2560c4d-7fab-4e97-a829-6fcec2c5a278', 'Conditional', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('e6b40943-ae4c-45a0-95cd-3d74c7b2828b', 'b2560c4d-7fab-4e97-a829-6fcec2c5a278', 'For loop and While loop', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('87dfc434-27fe-4c1c-980d-9307c8786d58', 'b2560c4d-7fab-4e97-a829-6fcec2c5a278', 'Iterating Over Multiple Sequences using enumerate and zip', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d82e088f-bf58-4050-b20a-de1845d4d884', 'b2560c4d-7fab-4e97-a829-6fcec2c5a278', 'List Comprehension', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('71b0348b-3689-441e-9922-e0ec5b4c9f5c', '61799cc5-de01-41d4-b8b0-803ce1e66bd5', 'Function Syntax', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('7f7e0431-750e-4df0-bcc5-f71c096451f2', '61799cc5-de01-41d4-b8b0-803ce1e66bd5', 'Return Values', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('60acc042-1a46-4360-bc69-b88c6f304b21', '61799cc5-de01-41d4-b8b0-803ce1e66bd5', 'Default Arguments', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('1df64846-d359-4b48-8966-dfd65caa38b7', '61799cc5-de01-41d4-b8b0-803ce1e66bd5', 'Variable Arguments', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('464107d5-65f3-4869-bafb-404e87a1ee71', '61799cc5-de01-41d4-b8b0-803ce1e66bd5', 'Lambda, Map, Filter', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('c8fbfecd-b8e2-4f74-8149-9181062c1a99', 'fc4fad35-0c06-4e21-8b03-799afdb01543', 'Modules', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('3064f4fc-2ac1-4fcd-97a5-7fb7a7d807d7', 'fc4fad35-0c06-4e21-8b03-799afdb01543', 'Python Standard Libraries', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('0f5bbaea-c386-42ad-b8c9-a3159a6aa464', 'fc4fad35-0c06-4e21-8b03-799afdb01543', 'Third party models for decision making', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('e835c839-3a8f-43d9-8b86-33228da27aff', 'fc4fad35-0c06-4e21-8b03-799afdb01543', 'Third Party Packages', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('90f79353-82db-4363-86a3-b7f112bd225b', 'a5e70f96-efdf-47c6-8481-bf16ce89580a', 'What is R', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('14a94a4c-6095-4775-8db7-360391926f65', 'a5e70f96-efdf-47c6-8481-bf16ce89580a', 'Install R', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('6603f24a-7931-4947-9c35-a0b1b8525028', 'a5e70f96-efdf-47c6-8481-bf16ce89580a', 'Install RStudio IDE', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('2fe0b9d6-0f3b-47cf-83c4-fad67ca321e9', 'a5e70f96-efdf-47c6-8481-bf16ce89580a', 'Explore RStudio Interface', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('979d5fb0-4d18-46fb-8f51-93fe5af7e241', 'a5e70f96-efdf-47c6-8481-bf16ce89580a', 'Code R Script', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('e061c678-41a7-48a8-ab5e-f0e984a779d2', '529ff727-84a3-4e39-9ad8-e27d2ffcf2df', 'Numbers', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('7a263527-430e-4a88-8a21-8646c89e52ba', '529ff727-84a3-4e39-9ad8-e27d2ffcf2df', 'String', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('b4287d03-9ff0-4a3f-95c0-9c81fb02b8ba', '529ff727-84a3-4e39-9ad8-e27d2ffcf2df', 'Vector', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('b1db70db-d4a2-41b4-af94-e23142ea69c3', '529ff727-84a3-4e39-9ad8-e27d2ffcf2df', 'Matrix', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('42d19f7b-0f7e-4c56-8f4f-53be660b5a86', '529ff727-84a3-4e39-9ad8-e27d2ffcf2df', 'Array', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('7b0c378d-2367-4f2a-890f-4645f9aaf423', '529ff727-84a3-4e39-9ad8-e27d2ffcf2df', 'Data Frame', '6');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('917810fa-33e4-47fe-960c-a57349cd7bec', '529ff727-84a3-4e39-9ad8-e27d2ffcf2df', 'List', '7');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('6fc0c846-7c77-4375-96b9-901ebcf179d7', '529ff727-84a3-4e39-9ad8-e27d2ffcf2df', 'Factor', '8');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('8ead209a-9e44-47f7-9605-2ce0436408d4', 'cea33e7d-b4b7-4e8d-adec-d7b90d570ca6', 'Import R Packages', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('70b59736-de64-4cc4-8190-c8d385ebb4fb', 'cea33e7d-b4b7-4e8d-adec-d7b90d570ca6', 'Import R Data Sets', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ce9e1bf7-d64c-4ae6-a811-e64aa4cf41b3', 'cea33e7d-b4b7-4e8d-adec-d7b90d570ca6', 'Import External Data', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d94980fd-ddde-4cdf-9302-9fb0c939933e', 'cea33e7d-b4b7-4e8d-adec-d7b90d570ca6', 'Export Data', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('dad6d2f0-96f9-4201-b70e-2e98dc6d468f', '0eefde3c-a9a3-4119-9aab-f457272e1038', 'Scatter Plot', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('0445627c-66e1-4a6c-9995-0b4aa9ce68cc', '0eefde3c-a9a3-4119-9aab-f457272e1038', 'Boxplot', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('624d06a8-e914-432b-a277-d89b558041f4', '0eefde3c-a9a3-4119-9aab-f457272e1038', 'Bar chart', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('83e5ec02-dfc3-45ba-b367-b3979dd9cf6d', '0eefde3c-a9a3-4119-9aab-f457272e1038', 'Pie chart', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('f7e2cb91-c76b-474c-8536-13287e813e0b', '0eefde3c-a9a3-4119-9aab-f457272e1038', 'Histogram', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ad744d97-0582-4a8d-9f10-f34df962309e', '733db087-60ce-4fc4-a89d-e5046814c2de', 'Conditional', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ea5f0b12-2513-4efe-963a-428f4e09ad22', '733db087-60ce-4fc4-a89d-e5046814c2de', 'Loop', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('f4df7031-0f0a-468c-8509-5936d114e631', '733db087-60ce-4fc4-a89d-e5046814c2de', 'Break & Next', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('515a1e94-435d-468a-9810-f8fad52d1ed8', '733db087-60ce-4fc4-a89d-e5046814c2de', 'Function Syntax', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('a5a44f83-ccfb-4a4b-a474-4bdf31726e0f', '733db087-60ce-4fc4-a89d-e5046814c2de', 'Default Arguments', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('68d8abf0-a865-4a14-8eb1-57132f4e252d', '913c9b02-ef28-454b-a134-b4e183120816', 'Descriptive Statistics', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('2c980fed-aedd-48ec-90a8-abaa7e72c56f', '913c9b02-ef28-454b-a134-b4e183120816', 'Linear Regression Methods', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('c0927644-3f93-4643-9a32-270ba688a31a', '913c9b02-ef28-454b-a134-b4e183120816', 'Correlation Methods', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('94f5b607-ff1a-4f0b-b898-188e588a1ced', '913c9b02-ef28-454b-a134-b4e183120816', 'Hypothesis Testing', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('95be95fc-2312-4233-9acc-7ede686226ad', '913c9b02-ef28-454b-a134-b4e183120816', 'Analysis of Variance (ANOVA)', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('5d4a323f-8520-4ab2-b0a3-01053f3e7f1c', '40e35052-a6af-41f3-ae69-e6b21b0cad07', 'Coding using comprehensions', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('9462a27a-ea33-43d0-8b0f-393e0a46e1e9', '5084ad59-e74b-416d-b96b-a5cb316562ea', 'Create Python functions to meet business use cases', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('8f70bcd6-273b-4927-a5c5-7f9be88ffdcd', '5084ad59-e74b-416d-b96b-a5cb316562ea', 'Lambda function and its applications', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('5d7b167f-1669-4a20-9183-add647d5d440', '7d2dc532-7cfe-4425-a459-4e30a91315ed', 'Data analysis using Pandas package', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('07fbffb2-2d90-4a45-9a19-fc5e5a7e926f', '7d2dc532-7cfe-4425-a459-4e30a91315ed', 'DataFrame and Series data structures', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('487cbbc9-cab3-4ca3-ae25-bec5f815181c', '7d2dc532-7cfe-4425-a459-4e30a91315ed', 'Import finance data', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('5b0ec136-848e-4b8d-b9bc-77310ddddf9f', '7d2dc532-7cfe-4425-a459-4e30a91315ed', 'Filter and slice finance data', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ed15c7e8-2c13-41c0-8627-fa41b37c2452', '7d2dc532-7cfe-4425-a459-4e30a91315ed', 'Clean missing data', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('7768887d-b506-482a-a123-221549d5519a', 'dd73458b-8ba3-40a5-b3f3-c56f659d732f', 'Join finance data with concat, append and merge', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('83007837-84d5-4488-acbd-e72f8b097d14', 'dd73458b-8ba3-40a5-b3f3-c56f659d732f', 'Aggregate data with groupby and pivot table', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('772a32d7-7f4b-496c-ba19-6f805cc07562', 'dd73458b-8ba3-40a5-b3f3-c56f659d732f', 'Assess codes to identify gaps', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('bba1ee43-3fa7-41cc-9846-f9646a3fbec4', 'dd73458b-8ba3-40a5-b3f3-c56f659d732f', 'Test and visualize finance data', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('0d7ba636-de82-4c31-b5a1-17045eddb536', 'c5be2e8c-bd6f-4a60-9814-88d4528c56d3', 'Improve codes with pipe and apply', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('6ee0d763-1c95-4340-b3f9-0ba75d07ae2d', 'c5be2e8c-bd6f-4a60-9814-88d4528c56d3', 'Applications of statistics', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('35327a5b-3484-4fe6-bb26-ffec71c65795', 'c5be2e8c-bd6f-4a60-9814-88d4528c56d3', 'Analyse finance data to track any changes', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('ada6b633-6133-455c-bf89-3b55f43ba0a4', '89982332-7495-4817-b815-c477b239983d', 'Comprehension syntax', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('9c895c6f-176d-41ef-90d7-d26e2acb8748', '89982332-7495-4817-b815-c477b239983d', 'Types of comprehension', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('34ddeaf3-dcb6-4a68-b9e3-90f1b1587962', '89982332-7495-4817-b815-c477b239983d', 'Generator syntax', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('000283f6-f104-4d10-910f-8cc8e3e3106f', '89982332-7495-4817-b815-c477b239983d', 'Types of generators', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('66604227-e23b-4a8a-8fbb-b4f681ee90ee', 'f48fce53-175a-4c55-bb9d-6bbfd79086d1', 'Read and write data to Files', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('3ce08a1e-8d33-468f-bc6d-14fa05faf3b7', 'f48fce53-175a-4c55-bb9d-6bbfd79086d1', 'Manage File and Folders with Python OS Module', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('3341c413-06ce-4bbc-a2a3-a01b6472a136', 'f48fce53-175a-4c55-bb9d-6bbfd79086d1', 'Manage Paths with Python Pathlib Module ', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('df8d7fc4-e6fd-4b69-ae36-e271e5a291e5', '8ceea594-068f-4305-a8a7-170d95e4f877', 'Introduction to Object Oriented Programming', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('dc8aa462-922d-42b4-bf42-976eb4980e09', '8ceea594-068f-4305-a8a7-170d95e4f877', 'Create class and objects', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d4291929-a246-4b83-ba63-30ae37f0da2c', '8ceea594-068f-4305-a8a7-170d95e4f877', 'Method and overloading', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d8c15cd8-a750-4d32-819d-ed06bc12155f', '8ceea594-068f-4305-a8a7-170d95e4f877', 'Initializer & destructor', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('e56a203b-68c0-4b18-9591-27e9e26b6816', '8ceea594-068f-4305-a8a7-170d95e4f877', 'Inheritance', '5');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('46d822fb-12d3-4abc-a45e-f5973546b946', '8ceea594-068f-4305-a8a7-170d95e4f877', 'Polymorphism', '6');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('416077f3-727e-4300-b8bd-e4953dbcbdec', '216340e6-033e-40b0-a540-3462923c1428', 'Setup SQLite3 database', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('e0e1c5ff-6818-456f-83e5-0025ba69d341', '216340e6-033e-40b0-a540-3462923c1428', 'Apply CRUD operations on SQLite3', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('c1f10275-13b9-4d1c-bfb8-dfd8598a54f7', '216340e6-033e-40b0-a540-3462923c1428', 'Integrate to external databases', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d6b50343-0b02-43e7-a029-6f325abc0dbb', '4e9eea41-5a2a-4946-a624-19a3e02529d4', 'Exceptions versus Syntax Errors', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('347598a3-0a9a-43de-beee-feaa02478f53', '4e9eea41-5a2a-4946-a624-19a3e02529d4', 'Handle Exceptions with Try and Except blocks', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('4c0903e5-1a6c-4b6b-93c0-64e5dc68b440', '4e9eea41-5a2a-4946-a624-19a3e02529d4', 'The Else clause', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('7a5fbde8-b4d1-4ff3-87c9-48471db1fe67', '4e9eea41-5a2a-4946-a624-19a3e02529d4', 'Clean up with Finally', '4');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('d1f6e8c2-0ac3-4e14-a6f8-9556ec76c139', 'd0b35581-32a3-40d7-a0f8-45b99c698923', 'Overview of Computer Vision', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('da337a91-3523-4bfa-8406-77419880136a', 'd0b35581-32a3-40d7-a0f8-45b99c698923', 'Computer Vision Industrial Applications', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('0e13532a-bff9-46f9-880e-8323b80dd2e0', 'd0b35581-32a3-40d7-a0f8-45b99c698923', 'Traditional vs Deep Learning Based Computer Vision', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('dbc90dc8-f679-45f6-b363-7b523afaab82', '58047ff1-03a8-4ed6-b310-9fc8bd1e34f5', 'Image Classification Model with CNN Data Augmentation and Dropout', '3');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('e9b066d2-1d2a-4b1e-9720-fd126c7ba0ca', 'f95f919a-6269-4756-bc35-a08a1d6d45fb', 'Introduction to Transfer Learning', '1');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('8dbafd9a-5a88-4dde-8024-a116e50af4f6', 'f95f919a-6269-4756-bc35-a08a1d6d45fb', 'Applications of Pre-Trained Models', '2');
INSERT INTO public.subtopic (id, learning_unit_id, title, "position") VALUES ('4c57e2bd-b2ae-4680-83cc-a94d1811548a', 'f95f919a-6269-4756-bc35-a08a1d6d45fb', 'Fine Tuning Pre-Trained Models', '3');


--
-- TOC entry 5327 (class 0 OID 16979)
-- Dependencies: 242
-- Data for Name: subtopic_completion; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at) VALUES ('99999999-9999-4999-8999-999999999901', '90f79353-82db-4363-86a3-b7f112bd225b', '2025-09-30 14:27:39.705342+08');
INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at) VALUES ('99999999-9999-4999-8999-999999999901', '14a94a4c-6095-4775-8db7-360391926f65', '2025-09-30 14:27:40.721285+08');
INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at) VALUES ('99999999-9999-4999-8999-999999999912', 'a09efdf8-018a-497b-96a4-5996852e8846', '2025-10-02 09:16:56.755723+08');
INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at) VALUES ('99999999-9999-4999-8999-999999999912', '2015e183-5759-4a0c-91de-981f3094abf7', '2025-10-02 09:20:00.778341+08');
INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at) VALUES ('99999999-9999-4999-8999-999999999912', '80f30a14-720b-43e0-b06e-418b9e83e569', '2025-10-02 09:20:00.940075+08');
INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at) VALUES ('99999999-9999-4999-8999-999999999911', '2015e183-5759-4a0c-91de-981f3094abf7', '2025-10-02 09:20:09.180655+08');
INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at) VALUES ('99999999-9999-4999-8999-999999999911', 'a09efdf8-018a-497b-96a4-5996852e8846', '2025-10-02 09:20:10.085289+08');
INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at) VALUES ('99999999-9999-4999-8999-999999999909', 'a09efdf8-018a-497b-96a4-5996852e8846', '2025-10-02 09:38:19.781521+08');
INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at) VALUES ('99999999-9999-4999-8999-999999999909', '2015e183-5759-4a0c-91de-981f3094abf7', '2025-10-02 09:38:20.65918+08');
INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at) VALUES ('99999999-9999-4999-8999-999999999908', 'ada6b633-6133-455c-bf89-3b55f43ba0a4', '2025-10-02 09:38:32.619976+08');
INSERT INTO public.subtopic_completion (enrollment_id, subtopic_id, completed_at) VALUES ('99999999-9999-4999-8999-999999999908', '9c895c6f-176d-41ef-90d7-d26e2acb8748', '2025-10-02 09:38:32.916862+08');


--
-- TOC entry 5328 (class 0 OID 16983)
-- Dependencies: 243
-- Data for Name: trainer_profile; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.trainer_profile (user_id, tel, gender, trainer_type, status, linkedin_url, cv_url, qualifications, education, areas_of_expertise, cv_original_filename) VALUES ('22222222-2222-4222-8222-222222222222', '90504915', 'Prefer not to say', 'ACLP', 'Active', 'www.linkedin.com/in/wong-xin-ping', 'http://localhost:3001/uploads/trainers/cv/1759714880279_WONG_XIN_PING_Resume.pdf', '["DACE", "ACLP"]', 'Degree', '["Infocomm Technology", "Landscape", "Training and Adult Education", "Environmental Services", "Design"]', 'WONG XIN PING Resume.pdf');
INSERT INTO public.trainer_profile (user_id, tel, gender, trainer_type, status, linkedin_url, cv_url, qualifications, education, areas_of_expertise, cv_original_filename) VALUES ('fb090496-d9a5-47bf-8c31-439d04d4d4a9', '12345678', 'Male', 'DACE', 'Active', 'https://www.linkedin.com/in/dr-alvin/?originalSubdomain=sg', NULL, '{}', NULL, '{}', NULL);
INSERT INTO public.trainer_profile (user_id, tel, gender, trainer_type, status, linkedin_url, cv_url, qualifications, education, areas_of_expertise, cv_original_filename) VALUES ('7f22c45d-bda8-495c-9a4e-9135eecc0d52', '12345678', 'Female', 'ACLP', 'Active', NULL, NULL, '{}', NULL, '{}', NULL);
INSERT INTO public.trainer_profile (user_id, tel, gender, trainer_type, status, linkedin_url, cv_url, qualifications, education, areas_of_expertise, cv_original_filename) VALUES ('e4b8b465-2209-49e3-89de-536bb43f0987', '12345678', 'Male', 'ACLP', 'Active', NULL, NULL, '{}', NULL, '{}', NULL);


--
-- TOC entry 5329 (class 0 OID 16990)
-- Dependencies: 244
-- Data for Name: training_provider; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.training_provider (id, company_name, company_shortname, uen, company_address, contact_person_name, contact_tel, pro_forma_template_url, invoice_template_url, receipt_template_url, certificate_template_url, ssg_self_sign_cert_file, ssg_private_key_file, ssg_encryption_key, color_scheme, created_at, updated_at, sync_google_calendar, sync_ms_calendar, integrate_google_drive, integrate_ms_onedrive, auto_send_proforma_invoice, auto_send_confirm_email, auto_send_invoice, auto_send_receipt, auto_send_certificate, auto_send_thankyou_email, auto_mask_sensitive_data, auto_delete_after_six_months, enable_otp_login, enable_default_otp, default_otp, enable_leaderboard, enable_point_sys, normal_fund_rate, enhanced_fund_rate, gst_rate, gst_register) VALUES ('55555555-5555-5555-8555-555555555555', 'Tertiary Infotech', 'Tertiary', '201200696W', '12 Woodland Square #07-85/86/87 Woods Square Tower 1, Singapore 737715', 'Dr Alfred', '61000613', '/uploads/training_provider/pro_forma_invoice_template/1759478257620_Study Plan.txt', '/uploads/training_provider/invoice_template/1759478197184_cer1.docx', '/uploads/training_provider/receipt_template/1759478231535_cer2.docx', '/uploads/training_provider/certificate_template/1759478257614_database.txt', '/uploads/training_provider/self_signing_cert/1760410679073_tertiary_cert_v3.pem', '/uploads/training_provider/private_key/1760410679078_tertiary_private_key_v3.pem', '6+moA6QWaoZrOY34melsP2FHULBlzsA1XqPP/6P8quU=', '#258bb6', '2025-09-04 15:22:38.896186+08', '2025-10-14 10:57:59.083095+08', true, true, true, true, true, true, true, true, true, true, true, true, true, true, '112233', true, true, '50', '9', '9', false);


--
-- TOC entry 5330 (class 0 OID 17015)
-- Dependencies: 245
-- Data for Name: training_provider_api; Type: TABLE DATA; Schema: public; Owner: postgres
--


--
-- TOC entry 5331 (class 0 OID 17023)
-- Dependencies: 246
-- Data for Name: user_role_map; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.user_role_map (user_id, role) VALUES ('11111111-1111-4111-8111-111111111111', 'Learner');
INSERT INTO public.user_role_map (user_id, role) VALUES ('22222222-2222-4222-8222-222222222222', 'Trainer');
INSERT INTO public.user_role_map (user_id, role) VALUES ('33333333-3333-4333-8333-333333333333', 'Admin');
INSERT INTO public.user_role_map (user_id, role) VALUES ('44444444-4444-4444-8444-444444444444', 'Developer');
INSERT INTO public.user_role_map (user_id, role) VALUES ('11111111-1111-4111-8111-111111111112', 'Learner');
INSERT INTO public.user_role_map (user_id, role) VALUES ('11111111-1111-4111-8111-111111111113', 'Learner');
INSERT INTO public.user_role_map (user_id, role) VALUES ('55555555-5555-5555-8555-555555555555', 'Training Provider');
INSERT INTO public.user_role_map (user_id, role) VALUES ('fb090496-d9a5-47bf-8c31-439d04d4d4a9', 'Trainer');
INSERT INTO public.user_role_map (user_id, role) VALUES ('7f22c45d-bda8-495c-9a4e-9135eecc0d52', 'Trainer');
INSERT INTO public.user_role_map (user_id, role) VALUES ('e4b8b465-2209-49e3-89de-536bb43f0987', 'Trainer');


--
-- TOC entry 5332 (class 0 OID 17026)
-- Dependencies: 247
-- Data for Name: user_saved_job; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.user_saved_job (user_id, job_posting_id, saved_at) VALUES ('11111111-1111-4111-8111-111111111111', '78787878-aaaa-4bbb-8ccc-121212121212', '2025-09-30 16:00:00+08');


--
-- TOC entry 5333 (class 0 OID 17030)
-- Dependencies: 248
-- Data for Name: user_subtopic_bookmark; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.user_subtopic_bookmark (user_id, subtopic_id, created_at, course_run_id) VALUES ('22222222-2222-4222-8222-222222222222', 'a09efdf8-018a-497b-96a4-5996852e8846', '2025-10-01 17:47:28.311105+08', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9');
INSERT INTO public.user_subtopic_bookmark (user_id, subtopic_id, created_at, course_run_id) VALUES ('22222222-2222-4222-8222-222222222222', '2015e183-5759-4a0c-91de-981f3094abf7', '2025-10-01 17:47:28.613269+08', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9');
INSERT INTO public.user_subtopic_bookmark (user_id, subtopic_id, created_at, course_run_id) VALUES ('22222222-2222-4222-8222-222222222222', '80f30a14-720b-43e0-b06e-418b9e83e569', '2025-10-01 17:47:28.891537+08', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9');
INSERT INTO public.user_subtopic_bookmark (user_id, subtopic_id, created_at, course_run_id) VALUES ('11111111-1111-4111-8111-111111111111', 'a09efdf8-018a-497b-96a4-5996852e8846', '2025-10-02 09:19:40.138439+08', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9');
INSERT INTO public.user_subtopic_bookmark (user_id, subtopic_id, created_at, course_run_id) VALUES ('11111111-1111-4111-8111-111111111111', '2015e183-5759-4a0c-91de-981f3094abf7', '2025-10-02 09:19:50.370083+08', 'cccccccc-cccc-4ccc-8ccc-cccccccccc11');
INSERT INTO public.user_subtopic_bookmark (user_id, subtopic_id, created_at, course_run_id) VALUES ('11111111-1111-4111-8111-111111111111', '80f30a14-720b-43e0-b06e-418b9e83e569', '2025-10-02 09:19:50.718349+08', 'cccccccc-cccc-4ccc-8ccc-cccccccccc11');
INSERT INTO public.user_subtopic_bookmark (user_id, subtopic_id, created_at, course_run_id) VALUES ('11111111-1111-4111-8111-111111111111', 'a09efdf8-018a-497b-96a4-5996852e8846', '2025-10-02 09:19:52.598536+08', 'cccccccc-cccc-4ccc-8ccc-cccccccccc11');
INSERT INTO public.user_subtopic_bookmark (user_id, subtopic_id, created_at, course_run_id) VALUES ('11111111-1111-4111-8111-111111111113', 'a09efdf8-018a-497b-96a4-5996852e8846', '2025-10-02 09:36:08.635205+08', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9');
INSERT INTO public.user_subtopic_bookmark (user_id, subtopic_id, created_at, course_run_id) VALUES ('11111111-1111-4111-8111-111111111111', '248e8487-9793-49d2-ae36-0dbe6f393e30', '2026-01-20 23:01:30.535408+08', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9');


--
-- TOC entry 5334 (class 0 OID 17034)
-- Dependencies: 249
-- Data for Name: work_experience; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.work_experience (id, trainer_id, company, job_title, start_date, end_date, description, created_at, developer_id) VALUES ('d90dfd9f-51c7-4d41-a3b2-20f87131cdce', NULL, 'Wistech Consulting Pte Ltd', 'Data Analyst Intern', '2022-09-01', '2023-02-01', 'Analyze company sales data to provide insightful feedback', '2025-10-01 10:40:03.525954+08', '44444444-4444-4444-8444-444444444444');
INSERT INTO public.work_experience (id, trainer_id, company, job_title, start_date, end_date, description, created_at, developer_id) VALUES ('c001d88f-6eba-4ae9-bf38-6352d577568d', NULL, 'Tertiary Infotech', 'AI Automation Intern', '2025-09-01', NULL, 'Developing LMS system with Next.js, React, PostgreSQL', '2025-10-01 10:40:03.525954+08', '44444444-4444-4444-8444-444444444444');
INSERT INTO public.work_experience (id, trainer_id, company, job_title, start_date, end_date, description, created_at, developer_id) VALUES ('c8522f37-55bf-4177-8bc9-71c3b5ec8e58', '22222222-2222-4222-8222-222222222222', 'Data one Company', 'User Experience Centre (UXC)', '2021-09-01', '2022-05-01', 'Communicated design ideas through visuals and working prototypes. Used InDesign and Illustrator to create categorized school furniture catalogues. Rendered school spaces with Enscape and Photoshop, refining tone and lighting. Redesigned learning spaces for the “Classroom of the Future” project. Prototyped an actual pregnancy belly using affordable materials with Live Well Collab. Proficient in fablab tools including vacuum former, CNC, laser cutter, and 3D printer', '2025-10-13 11:17:41.051595+08', NULL);


--
-- TOC entry 5343 (class 0 OID 0)
-- Dependencies: 224
-- Name: calendar_event_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.calendar_event_id_seq', 1, false);


--
-- TOC entry 5023 (class 2606 OID 17044)
-- Name: admin_profile admin_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_profile
    ADD CONSTRAINT admin_profile_pkey PRIMARY KEY (user_id);


--
-- TOC entry 5025 (class 2606 OID 17046)
-- Name: app_user app_user_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_email_key UNIQUE (email);


--
-- TOC entry 5027 (class 2606 OID 17048)
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (id);


--
-- TOC entry 5031 (class 2606 OID 17050)
-- Name: assessment_grade assessment_grade_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_grade
    ADD CONSTRAINT assessment_grade_pkey PRIMARY KEY (enrollment_id, assessment_id);


--
-- TOC entry 5029 (class 2606 OID 17052)
-- Name: assessment assessment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment
    ADD CONSTRAINT assessment_pkey PRIMARY KEY (id);


--
-- TOC entry 5033 (class 2606 OID 17054)
-- Name: calendar_event calendar_event_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_event
    ADD CONSTRAINT calendar_event_pkey PRIMARY KEY (id);


--
-- TOC entry 5037 (class 2606 OID 17056)
-- Name: chat_conversation chat_conversation_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_conversation
    ADD CONSTRAINT chat_conversation_pkey PRIMARY KEY (id);


--
-- TOC entry 5039 (class 2606 OID 17058)
-- Name: chat_message chat_message_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_message
    ADD CONSTRAINT chat_message_pkey PRIMARY KEY (id);


--
-- TOC entry 5042 (class 2606 OID 17060)
-- Name: course course_course_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_course_code_key UNIQUE (course_code);


--
-- TOC entry 5044 (class 2606 OID 17062)
-- Name: course course_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course
    ADD CONSTRAINT course_pkey PRIMARY KEY (id);


--
-- TOC entry 5053 (class 2606 OID 17064)
-- Name: course_run_assessment course_run_assessment_course_run_id_assessment_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course_run_assessment
    ADD CONSTRAINT course_run_assessment_course_run_id_assessment_id_key UNIQUE (course_run_id, assessment_id);


--
-- TOC entry 5055 (class 2606 OID 17066)
-- Name: course_run_assessment course_run_assessment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course_run_assessment
    ADD CONSTRAINT course_run_assessment_pkey PRIMARY KEY (id);


--
-- TOC entry 5046 (class 2606 OID 17068)
-- Name: course_run course_run_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course_run
    ADD CONSTRAINT course_run_pkey PRIMARY KEY (id);


--
-- TOC entry 5057 (class 2606 OID 17070)
-- Name: developer_profile developer_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.developer_profile
    ADD CONSTRAINT developer_profile_pkey PRIMARY KEY (user_id);


--
-- TOC entry 5059 (class 2606 OID 17072)
-- Name: enrollment enrollment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.enrollment
    ADD CONSTRAINT enrollment_pkey PRIMARY KEY (id);


--
-- TOC entry 5061 (class 2606 OID 17074)
-- Name: enrollment enrollment_user_id_course_run_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.enrollment
    ADD CONSTRAINT enrollment_user_id_course_run_id_key UNIQUE (user_id, course_run_id);


--
-- TOC entry 5070 (class 2606 OID 17076)
-- Name: job_posting job_posting_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.job_posting
    ADD CONSTRAINT job_posting_pkey PRIMARY KEY (id);


--
-- TOC entry 5072 (class 2606 OID 17078)
-- Name: learner_profile learner_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learner_profile
    ADD CONSTRAINT learner_profile_pkey PRIMARY KEY (user_id);


--
-- TOC entry 5074 (class 2606 OID 17080)
-- Name: learning_unit learning_unit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_unit
    ADD CONSTRAINT learning_unit_pkey PRIMARY KEY (id);


--
-- TOC entry 5076 (class 2606 OID 17082)
-- Name: provider_admin_user provider_admin_user_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_admin_user
    ADD CONSTRAINT provider_admin_user_pkey PRIMARY KEY (provider_id, user_id);


--
-- TOC entry 5078 (class 2606 OID 17084)
-- Name: ssg_claims ssg_claims_claim_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ssg_claims
    ADD CONSTRAINT ssg_claims_claim_id_key UNIQUE (claim_id);


--
-- TOC entry 5080 (class 2606 OID 17086)
-- Name: ssg_claims ssg_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ssg_claims
    ADD CONSTRAINT ssg_claims_pkey PRIMARY KEY (id);


--
-- TOC entry 5082 (class 2606 OID 17088)
-- Name: ssg_enrolments ssg_enrolments_enrolment_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ssg_enrolments
    ADD CONSTRAINT ssg_enrolments_enrolment_id_key UNIQUE (enrolment_id);


--
-- TOC entry 5084 (class 2606 OID 17090)
-- Name: ssg_enrolments ssg_enrolments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ssg_enrolments
    ADD CONSTRAINT ssg_enrolments_pkey PRIMARY KEY (id);


--
-- TOC entry 5086 (class 2606 OID 17092)
-- Name: ssg_grants ssg_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ssg_grants
    ADD CONSTRAINT ssg_grants_pkey PRIMARY KEY (id);


--
-- TOC entry 5088 (class 2606 OID 17094)
-- Name: ssg_grants ssg_grants_reference_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ssg_grants
    ADD CONSTRAINT ssg_grants_reference_number_key UNIQUE (grant_id);


--
-- TOC entry 5092 (class 2606 OID 17096)
-- Name: submission submission_enrollment_assessment_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission
    ADD CONSTRAINT submission_enrollment_assessment_unique UNIQUE (enrollment_id, assessment_id);


--
-- TOC entry 5094 (class 2606 OID 17098)
-- Name: submission submission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission
    ADD CONSTRAINT submission_pkey PRIMARY KEY (id);


--
-- TOC entry 5100 (class 2606 OID 17100)
-- Name: subtopic_completion subtopic_completion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subtopic_completion
    ADD CONSTRAINT subtopic_completion_pkey PRIMARY KEY (enrollment_id, subtopic_id);


--
-- TOC entry 5098 (class 2606 OID 17102)
-- Name: subtopic subtopic_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subtopic
    ADD CONSTRAINT subtopic_pkey PRIMARY KEY (id);


--
-- TOC entry 5035 (class 2606 OID 17104)
-- Name: certification trainer_certification_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.certification
    ADD CONSTRAINT trainer_certification_pkey PRIMARY KEY (id);


--
-- TOC entry 5102 (class 2606 OID 17106)
-- Name: trainer_profile trainer_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.trainer_profile
    ADD CONSTRAINT trainer_profile_pkey PRIMARY KEY (user_id);


--
-- TOC entry 5115 (class 2606 OID 17108)
-- Name: work_experience trainer_work_experience_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_experience
    ADD CONSTRAINT trainer_work_experience_pkey PRIMARY KEY (id);


--
-- TOC entry 5107 (class 2606 OID 17110)
-- Name: training_provider_api training_provider_api_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.training_provider_api
    ADD CONSTRAINT training_provider_api_pkey PRIMARY KEY (id);


--
-- TOC entry 5104 (class 2606 OID 17112)
-- Name: training_provider training_provider_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.training_provider
    ADD CONSTRAINT training_provider_pkey PRIMARY KEY (id);


--
-- TOC entry 5051 (class 2606 OID 17114)
-- Name: course_run uq_course_run_per_course; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course_run
    ADD CONSTRAINT uq_course_run_per_course UNIQUE (course_id, course_run_id);


--
-- TOC entry 5096 (class 2606 OID 17116)
-- Name: submission uq_submission; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission
    ADD CONSTRAINT uq_submission UNIQUE (enrollment_id, assessment_id);


--
-- TOC entry 5109 (class 2606 OID 17118)
-- Name: user_role_map user_role_map_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_role_map
    ADD CONSTRAINT user_role_map_pkey PRIMARY KEY (user_id, role);


--
-- TOC entry 5111 (class 2606 OID 17120)
-- Name: user_saved_job user_saved_job_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_saved_job
    ADD CONSTRAINT user_saved_job_pkey PRIMARY KEY (user_id, job_posting_id);


--
-- TOC entry 5113 (class 2606 OID 17122)
-- Name: user_subtopic_bookmark user_subtopic_bookmark_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_subtopic_bookmark
    ADD CONSTRAINT user_subtopic_bookmark_pkey PRIMARY KEY (user_id, subtopic_id, course_run_id);


--
-- TOC entry 5040 (class 1259 OID 17123)
-- Name: idx_chat_conv; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chat_conv ON public.chat_message USING btree (conversation_id, created_at);


--
-- TOC entry 5047 (class 1259 OID 17124)
-- Name: idx_course_run_course; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_course_run_course ON public.course_run USING btree (course_id);


--
-- TOC entry 5048 (class 1259 OID 17125)
-- Name: idx_course_run_start_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_course_run_start_date ON public.course_run USING btree (start_date);


--
-- TOC entry 5049 (class 1259 OID 17126)
-- Name: idx_course_run_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_course_run_status ON public.course_run USING btree (class_status);


--
-- TOC entry 5062 (class 1259 OID 17127)
-- Name: idx_enrollment_course; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_enrollment_course ON public.enrollment USING btree (course_id);


--
-- TOC entry 5063 (class 1259 OID 17128)
-- Name: idx_enrollment_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_enrollment_user ON public.enrollment USING btree (user_id);


--
-- TOC entry 5064 (class 1259 OID 17129)
-- Name: idx_job_area; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_area ON public.job_posting USING btree (area);


--
-- TOC entry 5065 (class 1259 OID 17130)
-- Name: idx_job_company; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_company ON public.job_posting USING btree (company);


--
-- TOC entry 5066 (class 1259 OID 17131)
-- Name: idx_job_desc_gin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_desc_gin ON public.job_posting USING gin (description public.gin_trgm_ops);


--
-- TOC entry 5067 (class 1259 OID 17132)
-- Name: idx_job_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_location ON public.job_posting USING btree (location);


--
-- TOC entry 5068 (class 1259 OID 17133)
-- Name: idx_job_title_gin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_job_title_gin ON public.job_posting USING gin (title public.gin_trgm_ops);


--
-- TOC entry 5089 (class 1259 OID 17134)
-- Name: idx_submission_enroll; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_submission_enroll ON public.submission USING btree (enrollment_id);


--
-- TOC entry 5090 (class 1259 OID 17135)
-- Name: idx_submission_user_course; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_submission_user_course ON public.submission USING btree (enrollment_id, assessment_id);


--
-- TOC entry 5105 (class 1259 OID 17136)
-- Name: uq_training_provider_uen; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_training_provider_uen ON public.training_provider USING btree (uen);


--
-- TOC entry 5152 (class 2620 OID 17137)
-- Name: app_user trg_app_user_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_app_user_touch BEFORE UPDATE ON public.app_user FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- TOC entry 5153 (class 2620 OID 17138)
-- Name: assessment trg_assessment_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_assessment_touch BEFORE UPDATE ON public.assessment FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- TOC entry 5155 (class 2620 OID 17139)
-- Name: course_run trg_course_run_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_course_run_touch BEFORE UPDATE ON public.course_run FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- TOC entry 5154 (class 2620 OID 17140)
-- Name: course trg_course_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_course_touch BEFORE UPDATE ON public.course FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- TOC entry 5156 (class 2620 OID 17141)
-- Name: enrollment trg_enrollment_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_enrollment_touch BEFORE UPDATE ON public.enrollment FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- TOC entry 5157 (class 2620 OID 17142)
-- Name: job_posting trg_job_posting_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_job_posting_touch BEFORE UPDATE ON public.job_posting FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- TOC entry 5158 (class 2620 OID 17143)
-- Name: training_provider trg_training_provider_touch; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_training_provider_touch BEFORE UPDATE ON public.training_provider FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- TOC entry 5116 (class 2606 OID 17144)
-- Name: admin_profile admin_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admin_profile
    ADD CONSTRAINT admin_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- TOC entry 5117 (class 2606 OID 17149)
-- Name: assessment assessment_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment
    ADD CONSTRAINT assessment_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;


--
-- TOC entry 5118 (class 2606 OID 17154)
-- Name: assessment_grade assessment_grade_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_grade
    ADD CONSTRAINT assessment_grade_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessment(id) ON DELETE CASCADE;


--
-- TOC entry 5119 (class 2606 OID 17159)
-- Name: assessment_grade assessment_grade_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_grade
    ADD CONSTRAINT assessment_grade_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollment(id) ON DELETE CASCADE;


--
-- TOC entry 5120 (class 2606 OID 17164)
-- Name: calendar_event calendar_event_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendar_event
    ADD CONSTRAINT calendar_event_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;


--
-- TOC entry 5121 (class 2606 OID 17169)
-- Name: certification certification_developer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.certification
    ADD CONSTRAINT certification_developer_id_fkey FOREIGN KEY (developer_id) REFERENCES public.developer_profile(user_id);


--
-- TOC entry 5123 (class 2606 OID 17174)
-- Name: chat_conversation chat_conversation_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_conversation
    ADD CONSTRAINT chat_conversation_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- TOC entry 5124 (class 2606 OID 17179)
-- Name: chat_message chat_message_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_message
    ADD CONSTRAINT chat_message_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.chat_conversation(id) ON DELETE CASCADE;


--
-- TOC entry 5127 (class 2606 OID 17184)
-- Name: course_run_assessment course_run_assessment_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course_run_assessment
    ADD CONSTRAINT course_run_assessment_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessment(id) ON DELETE CASCADE;


--
-- TOC entry 5128 (class 2606 OID 17189)
-- Name: course_run_assessment course_run_assessment_course_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course_run_assessment
    ADD CONSTRAINT course_run_assessment_course_run_id_fkey FOREIGN KEY (course_run_id) REFERENCES public.course_run(id) ON DELETE CASCADE;


--
-- TOC entry 5125 (class 2606 OID 17194)
-- Name: course_run course_run_assigned_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course_run
    ADD CONSTRAINT course_run_assigned_trainer_id_fkey FOREIGN KEY (assigned_trainer_id) REFERENCES public.trainer_profile(user_id) ON DELETE SET NULL;


--
-- TOC entry 5126 (class 2606 OID 17199)
-- Name: course_run course_run_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.course_run
    ADD CONSTRAINT course_run_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;


--
-- TOC entry 5129 (class 2606 OID 17204)
-- Name: developer_profile developer_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.developer_profile
    ADD CONSTRAINT developer_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- TOC entry 5130 (class 2606 OID 17209)
-- Name: enrollment enrollment_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.enrollment
    ADD CONSTRAINT enrollment_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;


--
-- TOC entry 5131 (class 2606 OID 17214)
-- Name: enrollment enrollment_course_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.enrollment
    ADD CONSTRAINT enrollment_course_run_id_fkey FOREIGN KEY (course_run_id) REFERENCES public.course_run(id) ON DELETE CASCADE;


--
-- TOC entry 5132 (class 2606 OID 17219)
-- Name: enrollment enrollment_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.enrollment
    ADD CONSTRAINT enrollment_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- TOC entry 5122 (class 2606 OID 17224)
-- Name: certification fk_trainer_certification_trainer; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.certification
    ADD CONSTRAINT fk_trainer_certification_trainer FOREIGN KEY (trainer_id) REFERENCES public.trainer_profile(user_id) ON DELETE CASCADE;


--
-- TOC entry 5150 (class 2606 OID 17229)
-- Name: work_experience fk_trainer_work_experience_trainer; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_experience
    ADD CONSTRAINT fk_trainer_work_experience_trainer FOREIGN KEY (trainer_id) REFERENCES public.trainer_profile(user_id) ON DELETE CASCADE;


--
-- TOC entry 5143 (class 2606 OID 17234)
-- Name: training_provider_api fk_training_provider_api_provider; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.training_provider_api
    ADD CONSTRAINT fk_training_provider_api_provider FOREIGN KEY (training_provider_id) REFERENCES public.training_provider(id) ON DELETE CASCADE;


--
-- TOC entry 5147 (class 2606 OID 17239)
-- Name: user_subtopic_bookmark fk_user_subtopic_bookmark_course_run; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_subtopic_bookmark
    ADD CONSTRAINT fk_user_subtopic_bookmark_course_run FOREIGN KEY (course_run_id) REFERENCES public.course_run(id) ON DELETE CASCADE;


--
-- TOC entry 5133 (class 2606 OID 17244)
-- Name: learner_profile learner_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learner_profile
    ADD CONSTRAINT learner_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- TOC entry 5134 (class 2606 OID 17249)
-- Name: learning_unit learning_unit_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.learning_unit
    ADD CONSTRAINT learning_unit_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE;


--
-- TOC entry 5135 (class 2606 OID 17254)
-- Name: provider_admin_user provider_admin_user_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_admin_user
    ADD CONSTRAINT provider_admin_user_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.training_provider(id) ON DELETE CASCADE;


--
-- TOC entry 5136 (class 2606 OID 17259)
-- Name: provider_admin_user provider_admin_user_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_admin_user
    ADD CONSTRAINT provider_admin_user_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- TOC entry 5137 (class 2606 OID 17264)
-- Name: submission submission_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission
    ADD CONSTRAINT submission_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessment(id) ON DELETE CASCADE;


--
-- TOC entry 5138 (class 2606 OID 17269)
-- Name: submission submission_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission
    ADD CONSTRAINT submission_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollment(id) ON DELETE CASCADE;


--
-- TOC entry 5140 (class 2606 OID 17274)
-- Name: subtopic_completion subtopic_completion_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subtopic_completion
    ADD CONSTRAINT subtopic_completion_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.enrollment(id) ON DELETE CASCADE;


--
-- TOC entry 5141 (class 2606 OID 17279)
-- Name: subtopic_completion subtopic_completion_subtopic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subtopic_completion
    ADD CONSTRAINT subtopic_completion_subtopic_id_fkey FOREIGN KEY (subtopic_id) REFERENCES public.subtopic(id) ON DELETE CASCADE;


--
-- TOC entry 5139 (class 2606 OID 17284)
-- Name: subtopic subtopic_learning_unit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subtopic
    ADD CONSTRAINT subtopic_learning_unit_id_fkey FOREIGN KEY (learning_unit_id) REFERENCES public.learning_unit(id) ON DELETE CASCADE;


--
-- TOC entry 5142 (class 2606 OID 17289)
-- Name: trainer_profile trainer_profile_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.trainer_profile
    ADD CONSTRAINT trainer_profile_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- TOC entry 5144 (class 2606 OID 17294)
-- Name: user_role_map user_role_map_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_role_map
    ADD CONSTRAINT user_role_map_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- TOC entry 5145 (class 2606 OID 17299)
-- Name: user_saved_job user_saved_job_job_posting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_saved_job
    ADD CONSTRAINT user_saved_job_job_posting_id_fkey FOREIGN KEY (job_posting_id) REFERENCES public.job_posting(id) ON DELETE CASCADE;


--
-- TOC entry 5146 (class 2606 OID 17304)
-- Name: user_saved_job user_saved_job_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_saved_job
    ADD CONSTRAINT user_saved_job_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- TOC entry 5148 (class 2606 OID 17309)
-- Name: user_subtopic_bookmark user_subtopic_bookmark_subtopic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_subtopic_bookmark
    ADD CONSTRAINT user_subtopic_bookmark_subtopic_id_fkey FOREIGN KEY (subtopic_id) REFERENCES public.subtopic(id) ON DELETE CASCADE;


--
-- TOC entry 5149 (class 2606 OID 17314)
-- Name: user_subtopic_bookmark user_subtopic_bookmark_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_subtopic_bookmark
    ADD CONSTRAINT user_subtopic_bookmark_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE CASCADE;


--
-- TOC entry 5151 (class 2606 OID 17319)
-- Name: work_experience work_experience_developer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_experience
    ADD CONSTRAINT work_experience_developer_id_fkey FOREIGN KEY (developer_id) REFERENCES public.developer_profile(user_id);


-- Completed on 2026-01-21 00:30:37

--
-- PostgreSQL database dump complete
--
