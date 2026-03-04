-- =============================================================================
-- 02-init-admin.sql
-- Creates the default protected admin account on a fresh database.
--
-- Credentials are read from PostgreSQL GUC variables passed via docker-compose:
--   app.admin_email, app.admin_password, app.admin_name
--   app.company_name, app.partner_uen, app.partner_code
--
-- If a GUC variable is not set, safe placeholder defaults are used.
-- IMPORTANT: Change the admin password on first login.
-- =============================================================================

DO $$
DECLARE
    v_admin_email    TEXT := COALESCE(NULLIF(current_setting('app.admin_email',    true), ''), 'admin@example.com');
    v_admin_password TEXT := COALESCE(NULLIF(current_setting('app.admin_password', true), ''), 'ChangeMe123!');
    v_admin_name     TEXT := COALESCE(NULLIF(current_setting('app.admin_name',     true), ''), 'System Administrator');
    v_company_name   TEXT := COALESCE(NULLIF(current_setting('app.company_name',   true), ''), 'My Company');
    v_partner_uen    TEXT := COALESCE(NULLIF(current_setting('app.partner_uen',    true), ''), '000000000A');
    v_user_id        UUID := gen_random_uuid();
    v_provider_id    UUID;
BEGIN
    -- Skip if a protected admin already exists
    IF EXISTS (SELECT 1 FROM public.app_user WHERE is_protected = true LIMIT 1) THEN
        RAISE NOTICE 'Protected admin already exists — skipping init.';
        RETURN;
    END IF;

    -- Create the training provider record
    INSERT INTO public.training_provider (id, company_name, uen, created_at, updated_at)
    VALUES (gen_random_uuid(), v_company_name, v_partner_uen, NOW(), NOW())
    ON CONFLICT (uen) DO NOTHING;

    SELECT id INTO v_provider_id FROM public.training_provider WHERE uen = v_partner_uen;

    -- Create the admin user
    -- pgcrypto crypt() with blowfish (bf) produces a bcrypt hash compatible with bcryptjs
    INSERT INTO public.app_user
        (id, email, password_hash, full_name, account_status, is_protected, created_at, updated_at)
    VALUES
        (v_user_id, v_admin_email, crypt(v_admin_password, gen_salt('bf', 10)),
         v_admin_name, 'active', true, NOW(), NOW());

    -- Assign every role so the account can access all areas immediately
    INSERT INTO public.user_role_map (user_id, role) VALUES
        (v_user_id, 'Learner'),
        (v_user_id, 'Trainer'),
        (v_user_id, 'Admin'),
        (v_user_id, 'Developer'),
        (v_user_id, 'Training Provider')
    ON CONFLICT DO NOTHING;

    -- Link to the training provider
    INSERT INTO public.provider_admin_user (provider_id, user_id)
    VALUES (v_provider_id, v_user_id)
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Default admin created: % | company: %', v_admin_email, v_company_name;
END $$;
