-- Migration: Add company_logo_url to training_provider table
-- This separates the company logo from individual user profile pictures.
-- All users with "Training Provider" role share the same company logo.

ALTER TABLE public.training_provider
ADD COLUMN IF NOT EXISTS company_logo_url text;

-- Copy existing logo from the master Training Provider user (angch@tertiaryinfotech.com)
-- This user's profile_picture_url becomes the shared company logo for all TP users
UPDATE public.training_provider tp
SET company_logo_url = au.profile_picture_url
FROM public.app_user au
WHERE LOWER(au.email) = 'angch@tertiaryinfotech.com'
  AND au.profile_picture_url IS NOT NULL
  AND tp.company_logo_url IS NULL;
