-- Migration: cp_prompt_template — per-section prompt overrides for the CP Generator.
-- Each generator section (about_course, what_youll_learn, learning_outcomes, …)
-- has a built-in default prompt in lib/cp-prompts.ts. When the supervisor edits
-- a prompt through the template editor on the generator page, the customised
-- version is upserted here and takes precedence over the default at generation
-- time. If a row is absent (or equals the default), the default is used.
--
-- Templates are singleton (global) rather than per-user — the supervisor is the
-- sole editor and the expectation matches the Streamlit original where prompt
-- edits live in shared session state.
--
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS public.cp_prompt_template (
    section       text PRIMARY KEY,
    template      text NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT NOW(),
    updated_by    uuid REFERENCES public.app_user(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.cp_prompt_template IS
  'CP Generator prompt overrides. One row per section; absent row means use the built-in default from lib/cp-prompts.ts.';
