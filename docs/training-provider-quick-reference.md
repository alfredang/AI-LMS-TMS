# Quick Reference: Managing Training Provider Organizations

## Adding a User to Tertiary Infotech

```sql
-- Step 1: Create user account (if not exists)
INSERT INTO app_user (id, email, password, password_hash, full_name, created_at, updated_at)
VALUES (
    gen_random_uuid(),
    'user@example.com',
    'password123',
    '$2b$10$HASH_HERE',
    'User Full Name',
    NOW(),
    NOW()
)
ON CONFLICT (email) DO NOTHING
RETURNING id;

-- Step 2: Grant Training Provider role
INSERT INTO user_role_map (user_id, role)
VALUES (
    (SELECT id FROM app_user WHERE email = 'user@example.com'),
    'Training Provider'
)
ON CONFLICT (user_id, role) DO NOTHING;

-- Step 3: Link user to Tertiary Infotech organization
INSERT INTO training_provider_member (provider_id, user_id)
VALUES (
    '55555555-5555-5555-8555-555555555555',  -- Tertiary Infotech
    (SELECT id FROM app_user WHERE email = 'user@example.com')
)
ON CONFLICT (provider_id, user_id) DO NOTHING;
```

## Creating a New Training Provider Company

```sql
-- Step 1: Create the training provider organization
INSERT INTO training_provider (
    id,
    company_name,
    company_shortname,
    uen,
    company_address,
    contact_person_name,
    contact_tel,
    color_scheme,
    created_at,
    updated_at
) VALUES (
    gen_random_uuid(),
    'New Company Pte Ltd',
    'NewCo',
    '202300001K',
    '123 Business Street, Singapore 123456',
    'John Doe',
    '91234567',
    '#1E40AF',  -- Blue color scheme
    NOW(),
    NOW()
)
RETURNING id;

-- Step 2: Create admin user for this company
INSERT INTO app_user (id, email, password, password_hash, full_name, created_at, updated_at)
VALUES (
    gen_random_uuid(),
    'admin@newcompany.com',
    'password123',
    '$2b$10$HASH_HERE',
    'John Doe',
    NOW(),
    NOW()
)
RETURNING id;

-- Step 3: Grant Training Provider role
INSERT INTO user_role_map (user_id, role)
VALUES (
    (SELECT id FROM app_user WHERE email = 'admin@newcompany.com'),
    'Training Provider'
);

-- Step 4: Link user to the new organization
INSERT INTO training_provider_member (provider_id, user_id)
VALUES (
    (SELECT id FROM training_provider WHERE uen = '202300001K'),
    (SELECT id FROM app_user WHERE email = 'admin@newcompany.com')
);
```

## Checking User's Organization

```sql
-- Find which organization a user belongs to
SELECT 
    au.email,
    au.full_name,
    tp.company_name,
    tp.company_shortname,
    tp.uen
FROM app_user au
INNER JOIN training_provider_member tpm ON au.id = tpm.user_id
INNER JOIN training_provider tp ON tpm.provider_id = tp.id
WHERE au.email = 'user@example.com';
```

## Listing All Users in an Organization

```sql
-- List all users in Tertiary Infotech
SELECT 
    au.email,
    au.full_name,
    tpm.created_at as joined_at
FROM training_provider_member tpm
INNER JOIN app_user au ON tpm.user_id = au.id
WHERE tpm.provider_id = '55555555-5555-5555-8555-555555555555'
ORDER BY tpm.created_at;
```

## Moving a User to Different Organization

```sql
-- Remove from old organization and add to new one
BEGIN;

-- Remove from old organization
DELETE FROM training_provider_member 
WHERE user_id = (SELECT id FROM app_user WHERE email = 'user@example.com');

-- Add to new organization
INSERT INTO training_provider_member (provider_id, user_id)
VALUES (
    'NEW_PROVIDER_ID_HERE',
    (SELECT id FROM app_user WHERE email = 'user@example.com')
);

COMMIT;
```

## Removing a User from Organization

```sql
-- Remove user's organization membership (but keep their account)
DELETE FROM training_provider_member 
WHERE user_id = (SELECT id FROM app_user WHERE email = 'user@example.com');

-- Optionally remove their Training Provider role
DELETE FROM user_role_map
WHERE user_id = (SELECT id FROM app_user WHERE email = 'user@example.com')
  AND role = 'Training Provider';
```

## Common Queries

### Check if user has Training Provider role
```sql
SELECT EXISTS (
    SELECT 1 FROM user_role_map 
    WHERE user_id = (SELECT id FROM app_user WHERE email = 'user@example.com')
      AND role = 'Training Provider'
);
```

### List all training provider organizations
```sql
SELECT 
    tp.id,
    tp.company_name,
    tp.company_shortname,
    tp.uen,
    COUNT(tpm.user_id) as user_count
FROM training_provider tp
LEFT JOIN training_provider_member tpm ON tp.id = tpm.provider_id
GROUP BY tp.id, tp.company_name, tp.company_shortname, tp.uen
ORDER BY tp.company_name;
```

### Find users not linked to any organization
```sql
SELECT 
    au.id,
    au.email,
    au.full_name
FROM app_user au
INNER JOIN user_role_map urm ON au.id = urm.user_id
LEFT JOIN training_provider_member tpm ON au.id = tpm.user_id
WHERE urm.role = 'Training Provider'
  AND tpm.user_id IS NULL;
```
