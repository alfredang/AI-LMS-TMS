-- Add account_status column to app_user table
-- Values: 'active' (default) or 'disabled'
ALTER TABLE public.app_user
ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';
