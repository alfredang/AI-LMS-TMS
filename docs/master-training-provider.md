# Multi-Company Training Provider Implementation

## Overview
This feature implements a multi-company training provider system where each training provider organization can have multiple users. Users with the "Training Provider" role will see their own organization's profile based on their membership linkage.

## Key Concepts

### Training Provider Organizations
- Each training provider is a separate company/organization with its own:
  - Company information and branding
  - Templates (invoice, receipt, certificate, etc.)
  - API keys and integrations
  - Admin settings and preferences
  - Color scheme and customization

### User Membership
Users are linked to their training provider organization via the `training_provider_member` table:
- One user can belong to one training provider organization
- Multiple users can belong to the same organization
- Each user sees their organization's profile and settings

## Database Structure

### New Table: `training_provider_member`
```sql
CREATE TABLE training_provider_member (
    provider_id UUID NOT NULL REFERENCES training_provider(id),
    user_id UUID NOT NULL REFERENCES app_user(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (provider_id, user_id)
);
```

This table links users to their training provider organization.

### Example: Tertiary Infotech Setup
- **Company**: Tertiary Infotech
- **Provider ID**: `55555555-5555-5555-8555-555555555555`
- **Master User**: `angch@tertiaryinfotech.com`
- Other users can be added to the same organization via `training_provider_member`

## How It Works

### Profile Resolution
When a training provider user requests their profile, the system:

1. **First**: Checks `training_provider_member` table to find user's organization
2. **Second**: If not found, checks if user owns the training provider directly (user.id = training_provider.id)
3. **Third**: If still not found, checks `provider_admin_user` table (legacy support)

### Profile Access
All users linked to the same training provider organization will:
1. View the same company information
2. Share the same templates (invoice, receipt, certificate, etc.)
3. Use the same API keys and integrations
4. Have the same admin settings and preferences
5. See the same branding and color scheme

### Individual Authentication
- Each user maintains their own login credentials
- Authentication is separate from organization membership
- Users can have multiple roles (e.g., Training Provider + Trainer)

## Modified APIs

### 1. `/api/profile-new` (GET with role=training_provider)
- Queries `training_provider_member` to find user's organization
- Falls back to direct ownership or `provider_admin_user`
- Returns the organization's profile

### 2. `/api/training-provider/profile` (GET)
- Same organization lookup logic
- Returns profile for user's training provider organization

### 3. `/api/training-provider/update` (PUT)
- Identifies user's training provider organization
- Updates that organization's profile
- All users in the same organization see the changes

### 4. `/api/training-provider/info` (GET)
- Fetches basic training provider information (logo, name, OTP settings)
- Used for login screen and global app configuration

## Setup Instructions

### 1. Run Database Migration
```bash
psql -U postgres -d your_database -f database/migrations/05-master-training-provider.sql
```

This migration:
- Creates the `training_provider_member` table
- Sets up the default Tertiary Infotech organization
- Links the master user (`angch@tertiaryinfotech.com`) to Tertiary Infotech

### 2. Add Users to Organizations
To add a user to a training provider organization:

```sql
-- Add user to Tertiary Infotech
INSERT INTO training_provider_member (provider_id, user_id)
VALUES (
    '55555555-5555-5555-8555-555555555555',  -- Tertiary Infotech provider_id
    'USER_UUID_HERE'
);

-- Ensure user has Training Provider role
INSERT INTO user_role_map (user_id, role)
VALUES ('USER_UUID_HERE', 'Training Provider')
ON CONFLICT (user_id, role) DO NOTHING;
```

### 3. Create New Training Provider Organizations
To create a new training provider company:

```sql
-- 1. Create the training provider organization
INSERT INTO training_provider (
    id, company_name, company_shortname, uen, company_address,
    contact_person_name, contact_tel, ...
) VALUES (...);

-- 2. Create or link users to this organization
INSERT INTO training_provider_member (provider_id, user_id)
VALUES ('NEW_PROVIDER_ID', 'USER_ID');

-- 3. Grant Training Provider role to users
INSERT INTO user_role_map (user_id, role)
VALUES ('USER_ID', 'Training Provider');
```

## Benefits

1. **Multi-Tenancy**: Support multiple training provider companies
2. **Centralized Management**: Update organization settings in one place
3. **Consistency**: All users in an organization see the same information
4. **Scalability**: Easy to add new organizations and users
5. **Flexibility**: Users can switch organizations if needed
6. **Individual Security**: Each user has their own authentication

## Migration from Single Master

If you previously implemented a single master training provider:
- The new system is backward compatible
- Old `provider_admin_user` links still work
- Direct ownership (user.id = training_provider.id) still works
- New `training_provider_member` table provides the clearest organization structure

## Security Considerations

1. **Authentication**: Each user maintains their own login credentials
2. **Authorization**: Role-based access control via `user_role_map`
3. **Organization Isolation**: Users only see their organization's data
4. **Profile Updates**: Any user in the organization can update the shared profile
5. **Data Integrity**: Foreign key constraints ensure valid relationships

## Future Enhancements

Consider these potential improvements:
1. **Role Hierarchy**: Owner vs. Member permissions within an organization
2. **User Management UI**: Admin interface to add/remove users from organizations
3. **Multi-Organization Users**: Allow users to belong to multiple organizations
4. **Organization Switching**: UI to switch between organizations
5. **Audit Logging**: Track profile changes and who made them
6. **Organization Templates**: Copy settings from one organization to another
