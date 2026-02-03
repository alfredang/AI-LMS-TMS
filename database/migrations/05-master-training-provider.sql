-- Migration: Multi-Company Training Provider Support
-- Purpose: Enable multiple training provider companies with users linked to their respective organizations
-- Each training provider user will see their company's profile based on training_provider_member linkage

-- Create training_provider_member table to link users with their training provider organization
CREATE TABLE IF NOT EXISTS training_provider_member (
    provider_id UUID NOT NULL REFERENCES training_provider(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    PRIMARY KEY (provider_id, user_id)
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_training_provider_member_user_id 
    ON training_provider_member(user_id);

COMMENT ON TABLE training_provider_member IS 
    'Links users with Training Provider role to their training provider organization. Each user sees their own company profile.';

-- Set up the default/master training provider (Tertiary Infotech)
DO $$
DECLARE
    tertiary_tp_id UUID := '55555555-5555-5555-8555-555555555555';
    master_email TEXT := 'angch@tertiaryinfotech.com';
    master_user_id UUID;
BEGIN
    -- Create or update the master training provider user account
    INSERT INTO app_user (id, email, password, password_hash, full_name, profile_picture_url, created_at, updated_at)
    VALUES (
        gen_random_uuid(),
        master_email,
        'tertiary123',
        '$2b$10$R78KMh/2f.tqXEuUEYFg7u8JqtDmZIIwLJ.MxbUG64A9HX5zSMGnK',
        'Ang CH - Tertiary Infotech',
        '/uploads/training_provider/company_logo/1759475351223_tertiary_logo.png',
        NOW(),
        NOW()
    )
    ON CONFLICT (email) DO UPDATE 
    SET full_name = EXCLUDED.full_name,
        updated_at = NOW()
    RETURNING id INTO master_user_id;

    -- If user already existed, get their ID
    IF master_user_id IS NULL THEN
        SELECT id INTO master_user_id FROM app_user WHERE email = master_email;
    END IF;

    -- Ensure the user has Training Provider role
    INSERT INTO user_role_map (user_id, role)
    VALUES (master_user_id, 'Training Provider')
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Link the master user to Tertiary Infotech training provider organization
    INSERT INTO training_provider_member (provider_id, user_id)
    VALUES (tertiary_tp_id, master_user_id)
    ON CONFLICT (provider_id, user_id) DO NOTHING;

    RAISE NOTICE 'Multi-company training provider setup complete';
    RAISE NOTICE 'Master user "%" linked to Tertiary Infotech (ID: %)', master_email, tertiary_tp_id;
    RAISE NOTICE 'Users with Training Provider role will see their company profile based on training_provider_member linkage';
END $$;
