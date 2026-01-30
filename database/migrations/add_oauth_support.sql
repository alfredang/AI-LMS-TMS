-- Migration: Add OAuth support to app_user table
-- Created: 2026-01-30
-- Description: Add columns to support Google OAuth authentication

-- Add OAuth-specific columns to app_user table
ALTER TABLE public.app_user
ADD COLUMN IF NOT EXISTS supabase_user_id UUID,
ADD COLUMN IF NOT EXISTS auth_provider TEXT;

-- Make password fields nullable for OAuth users
ALTER TABLE public.app_user
ALTER COLUMN password DROP NOT NULL,
ALTER COLUMN password_hash DROP NOT NULL;

-- Add unique constraint on supabase_user_id
ALTER TABLE public.app_user
ADD CONSTRAINT app_user_supabase_user_id_unique UNIQUE (supabase_user_id);

-- Add index on auth_provider for faster queries
CREATE INDEX IF NOT EXISTS idx_app_user_auth_provider ON public.app_user(auth_provider);

-- Add index on supabase_user_id for faster OAuth lookups
CREATE INDEX IF NOT EXISTS idx_app_user_supabase_user_id ON public.app_user(supabase_user_id);

COMMENT ON COLUMN public.app_user.supabase_user_id IS 'Supabase Auth user ID for OAuth users';
COMMENT ON COLUMN public.app_user.auth_provider IS 'Authentication provider: google, password, etc.';
