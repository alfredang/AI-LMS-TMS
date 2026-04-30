-- AI-LMS-TMS Database Migration for Supabase
-- Generated: 2026-01-22T06:55:36.476Z
--
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
    'Individual',
    'Employer'
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
    'Hybrid',
    'External'
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
    'Training Provider',
    'Finance'
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
    secondary_email text,
    password text,
    password_hash text,
    full_name text NOT NULL,
    profile_picture_url text,
    account_status text NOT NULL DEFAULT 'active',
    is_protected boolean NOT NULL DEFAULT false,
    supabase_user_id uuid,
    auth_provider text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_valid CHECK ((POSITION(('@'::text) IN (email)) > 1)),
    CONSTRAINT app_user_supabase_user_id_unique UNIQUE (supabase_user_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_auth_provider ON public.app_user(auth_provider);
CREATE INDEX IF NOT EXISTS idx_app_user_supabase_user_id ON public.app_user(supabase_user_id);


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
    assessment_record_link text,
    courseware_link text,
    domain text,
    schedule_id text,
    funding_validity text,
    course_fees_exclude_gst text,
    course_fees_include_gst text,
    renewed_status text,
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
    practical_performance_assessment_link text,
    written_assessment_link text,
    assessment_methods jsonb,
    assessment_summary_record_url text,
    trainers_list text,
    trainers_email_list text,
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
    published_assessment_methods jsonb DEFAULT '{}'::jsonb,
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
    company_name text,
    company_uen text,
    gender text,
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
    enrolment_id text,
    enrolment_status text,
    nric text,
    email text,
    course_reference text,
    training_partner_code text,
    completion_date timestamp with time zone,
    raw_data jsonb,
    CONSTRAINT enrollment_progress_percent_check CHECK (((progress_percent >= (0)::numeric) AND (progress_percent <= (100)::numeric)))
);

CREATE INDEX IF NOT EXISTS idx_enrollment_enrolment_id ON public.enrollment(enrolment_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_nric ON public.enrollment(nric);


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
    CONSTRAINT ssg_claims_claim_id_key UNIQUE (claim_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ssg_claims_claim_id_unique_idx ON public.ssg_claims (claim_id);


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
    gender public.gender,
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
    nric text
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
    ssg_app1_cert_file text,
    ssg_app1_private_key_file text,
    ssg_app1_encryption_key text,
    ssg_app3_cert_file text,
    ssg_app3_private_key_file text,
    ssg_app3_encryption_key text,
    ssg_app4_client_id text,
    ssg_app4_client_secret text,
    ssg_default_app text DEFAULT 'app1',
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
    auto_enrol_direct_applications boolean DEFAULT false NOT NULL,
    auto_generate_qb_invoice boolean DEFAULT false NOT NULL,
    show_lesson_plan_learner_view boolean DEFAULT false NOT NULL,
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
    selected_ai_model text,
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
    company_email text,
    company_tel text,
    company_website text,
    da_invoice_email_cc text,
    da_invoice_email_bcc text,
    privacy_policy text,
    acceptable_use_policy text,
    otp_email_subject text,
    otp_email_body text,
    app1_cert_expiry               TIMESTAMP WITH TIME ZONE,
    app2_cert_expiry               TIMESTAMP WITH TIME ZONE,
    app3_cert_expiry               TIMESTAMP WITH TIME ZONE,
    app4_secret_last_generated_at  TIMESTAMP WITH TIME ZONE
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
    selected_model text,
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


--
-- Name: da_application; Type: TABLE; Schema: public; Owner: postgres
-- Merged from: 02-da-application.sql + add_da_application_columns.sql
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
    enrolment_status text DEFAULT NULL,
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
    invoice_doc_number text,
    invoice_drive_file_id text,
    invoice_drive_web_view_link text,
    grant_invoice_id character varying(100),
    grant_invoice_drive_file_id text,
    grant_invoice_drive_web_view_link text,
    sfc_invoice_id character varying(100),
    sfc_invoice_drive_file_id text,
    sfc_invoice_drive_web_view_link text,
    qb_customer_ref character varying(50),
    auto_enrol_status character varying(50),
    auto_enrol_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT da_application_pkey PRIMARY KEY (id),
    CONSTRAINT da_application_unique UNIQUE (application_id)
);

COMMENT ON TABLE public.da_application IS 'Stores Direct Application data imported from SSG Excel files';
COMMENT ON COLUMN public.da_application.enrolment_status IS 'Enrolment status from SSG API: Confirmed, Cancelled, or Not Found';
COMMENT ON COLUMN public.da_application.application_date IS 'Date when the application was submitted';
COMMENT ON COLUMN public.da_application.application_cancelled_by IS 'Entity or person who cancelled the application';
COMMENT ON COLUMN public.da_application.full_course_fee IS 'Full course fee before subsidies';
COMMENT ON COLUMN public.da_application.gst IS 'GST amount';
COMMENT ON COLUMN public.da_application.skillsfuture_subsidy IS 'SkillsFuture subsidy amount';
COMMENT ON COLUMN public.da_application.skillsfuture_credit IS 'SkillsFuture credit amount used';
COMMENT ON COLUMN public.da_application.skillsfuture_credit_claim_id IS 'SkillsFuture credit claim ID';
COMMENT ON COLUMN public.da_application.highest_qualification IS 'Trainee highest qualification';
COMMENT ON COLUMN public.da_application.highest_relevant_certification IS 'Trainee highest relevant certification';
COMMENT ON COLUMN public.da_application.enrolment_id IS 'SSG enrolment reference number returned by /tpg/enrolments';
COMMENT ON COLUMN public.da_application.grant_id IS 'SSG grant identifier from grant search';
COMMENT ON COLUMN public.da_application.invoice_id IS 'QuickBooks invoice ID for the net-fee invoice';
COMMENT ON COLUMN public.da_application.invoice_doc_number IS 'QuickBooks DocNumber of the main tax invoice (format TC{yy}-{mmdd}-{last6}). Cached to avoid qboReadInvoice on re-runs and used as PO# on supplemental Grant/SFC invoices.';
COMMENT ON COLUMN public.da_application.qb_customer_ref IS 'Cached QuickBooks CustomerRef for the trainee (find-or-create)';
COMMENT ON COLUMN public.da_application.auto_enrol_status IS 'Auto-enrol pipeline status: pending | enroled | grant_found | invoiced | failed';
COMMENT ON COLUMN public.da_application.invoice_drive_file_id IS 'Google Drive file id for the main tax invoice PDF';
COMMENT ON COLUMN public.da_application.invoice_drive_web_view_link IS 'Google Drive web view link for the main tax invoice PDF';
COMMENT ON COLUMN public.da_application.grant_invoice_id IS 'QuickBooks invoice id for the supplemental Grant invoice (positive amounts, DocNumber = SSG grant_id)';
COMMENT ON COLUMN public.da_application.grant_invoice_drive_file_id IS 'Google Drive file id for the Grant invoice PDF';
COMMENT ON COLUMN public.da_application.grant_invoice_drive_web_view_link IS 'Google Drive web view link for the Grant invoice PDF';
COMMENT ON COLUMN public.da_application.sfc_invoice_id IS 'QuickBooks invoice id for the supplemental SkillsFuture Credit invoice (positive amount, DocNumber = ssg_claims.claim_id)';
COMMENT ON COLUMN public.da_application.sfc_invoice_drive_file_id IS 'Google Drive file id for the SFC invoice PDF';
COMMENT ON COLUMN public.da_application.sfc_invoice_drive_web_view_link IS 'Google Drive web view link for the SFC invoice PDF';
COMMENT ON COLUMN public.da_application.auto_enrol_error IS 'Last error from auto-enrol pipeline, format: "<step>: <reason>"';

CREATE INDEX IF NOT EXISTS idx_da_application_application_id ON public.da_application(application_id);
CREATE INDEX IF NOT EXISTS idx_da_application_trainee_id ON public.da_application(trainee_id);
CREATE INDEX IF NOT EXISTS idx_da_application_course_run_id ON public.da_application(course_run_id);
CREATE INDEX IF NOT EXISTS idx_da_application_trainee_email ON public.da_application(trainee_email);
CREATE INDEX IF NOT EXISTS idx_da_application_auto_enrol_status ON public.da_application(auto_enrol_status);


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


-- ── Migrations integrated below ───────────────────────────────────────────────

-- From: add-attendance-tables.sql
-- course_session: one row per session within a course run
CREATE TABLE IF NOT EXISTS public.course_session (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    course_run_id uuid NOT NULL REFERENCES public.course_run(id) ON DELETE CASCADE,
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
    UNIQUE(course_run_id, ssg_session_id)
);

-- course_attendance: one row per (session × student)
-- user_id is nullable to support SSG trainees without a local account
-- Uniqueness enforced on (session_id, nric)
CREATE TABLE IF NOT EXISTS public.course_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES public.course_session(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.app_user(id) ON DELETE CASCADE,
    is_present boolean DEFAULT false NOT NULL,
    reason_of_absence text,
    nric text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT course_attendance_session_id_nric_key UNIQUE (session_id, nric)
);

CREATE INDEX IF NOT EXISTS idx_course_session_course_run ON public.course_session(course_run_id);
CREATE INDEX IF NOT EXISTS idx_course_attendance_session ON public.course_attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_course_attendance_nric ON public.course_attendance(nric);

-- course_trainer: many-to-many between course and trainer (app_user)
-- Populated by bulk upload when the Trainers column is present.
CREATE TABLE IF NOT EXISTS public.course_trainer (
    course_id  uuid NOT NULL REFERENCES public.course(id) ON DELETE CASCADE,
    trainer_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
    PRIMARY KEY (course_id, trainer_id)
);

CREATE INDEX IF NOT EXISTS idx_course_trainer_course   ON public.course_trainer(course_id);
CREATE INDEX IF NOT EXISTS idx_course_trainer_trainer  ON public.course_trainer(trainer_id);

-- From: add-link-assessment-columns.sql
-- Add columns for link-based assessment publish status to course_run
ALTER TABLE public.course_run ADD COLUMN IF NOT EXISTS written_assessment_published boolean DEFAULT false;
ALTER TABLE public.course_run ADD COLUMN IF NOT EXISTS practical_assessment_published boolean DEFAULT false;

-- link_assessment_submission: tracks submissions for link-based assessments (Written Assessment / Practical Performance Assessment)
-- These assessments are external links (e.g., Google Forms) stored in the course table, not the assessment table
-- This table is separate from the 'submission' table which tracks file-based assessment submissions
CREATE TABLE IF NOT EXISTS public.link_assessment_submission (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
    course_run_id uuid NOT NULL REFERENCES public.course_run(id) ON DELETE CASCADE,
    assessment_type VARCHAR(20) NOT NULL CHECK (assessment_type IN ('written', 'practical')),
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, course_run_id, assessment_type)
);

CREATE INDEX IF NOT EXISTS idx_link_assessment_submission_user ON public.link_assessment_submission(user_id);
CREATE INDEX IF NOT EXISTS idx_link_assessment_submission_course_run ON public.link_assessment_submission(course_run_id);

COMMENT ON TABLE public.link_assessment_submission IS 'Tracks file submissions for link-based assessments (Written/Practical). Separate from the submission table which handles file-based assessments.';
COMMENT ON COLUMN public.link_assessment_submission.assessment_type IS 'Type of link-based assessment: written or practical';

-- upcoming_course_runs_log: results from the daily upcoming TGS course runs fetch
CREATE TABLE IF NOT EXISTS public.upcoming_course_runs_log (
    id              SERIAL PRIMARY KEY,
    run_id          TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    course_run_id   TEXT,
    course_title    TEXT,
    course_code     TEXT,
    db_start_date   TEXT,
    db_end_date     TEXT,
    ssg_start_date  TEXT,
    ssg_end_date    TEXT,
    mode_of_learning TEXT,
    vacancy_code    TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    error_message   TEXT
);

-- api_subscription: SSG API subscription status per app
CREATE TABLE IF NOT EXISTS public.api_subscription (
    id          SERIAL PRIMARY KEY,
    api_name    VARCHAR(255) NOT NULL,
    version     VARCHAR(50),
    app1_status VARCHAR(50),   -- SKILLETO TERTIARY
    app2_status VARCHAR(50),   -- Training Management System
    app3_status VARCHAR(50),   -- Tertiary Infotech Academy
    app4_status VARCHAR(50),   -- TMS API (OAuth)
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Completed on 2026-01-21 00:30:37

--
-- PostgreSQL database dump complete
--

-- ============================================================
-- Support Ticketing System
-- ============================================================

-- Auto-increment sequence for ticket numbers
CREATE SEQUENCE IF NOT EXISTS public.support_ticket_number_seq START WITH 1 INCREMENT BY 1;

-- Support tickets raised by learners
CREATE TABLE IF NOT EXISTS public.support_ticket (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    ticket_number TEXT NOT NULL UNIQUE,
    user_id uuid NOT NULL REFERENCES public.app_user(id),
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    status TEXT NOT NULL DEFAULT 'Open',
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_user_id ON public.support_ticket(user_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_status ON public.support_ticket(status);

-- Replies on a support ticket (from admin or learner)
CREATE TABLE IF NOT EXISTS public.support_ticket_reply (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    ticket_id uuid NOT NULL REFERENCES public.support_ticket(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.app_user(id),
    user_role TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_reply_ticket_id ON public.support_ticket_reply(ticket_id);

-- Trigger to auto-update updated_at on support_ticket
CREATE TRIGGER support_ticket_updated_at
    BEFORE UPDATE ON public.support_ticket
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_updated_at();
