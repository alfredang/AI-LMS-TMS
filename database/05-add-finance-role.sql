-- Add 'Finance' to the user_role enum type
-- Place it after 'Admin' (before 'Training Provider' conceptually, but AFTER adds to end)
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'Finance';
