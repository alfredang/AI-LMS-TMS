# AI-LMS-TMS

Learning Management System & Training Management System with AI capabilities.

## Quick Links

- [Local Development Setup](#development-setup) - Get started locally
- [Deployment Guide](DEPLOYMENT.md) - Deploy to Vercel with Supabase
- [Recent Changes](#recent-changes--migrations) - Migration history and updates

## Technology Stack

- **Frontend & Backend**: Next.js (TypeScript)
- **Database**: PostgreSQL
- **Authentication**: JWT
- **File Uploads**: Multer
- **Styling**: Tailwind CSS

## Development Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
   - Copy `.env.example` to `.env.local`
   - Update database credentials and other required variables

3. Start development server:
```bash
npm run dev
```

The application will run on `http://localhost:3000`

## Environment Variables

Key environment variables in `.env.local`:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=ssg_lms_tms

# Application URLs
NEXT_PUBLIC_BASE_URL=http://localhost:3000
BASE_URL=http://localhost:3000

# JWT
JWT_SECRET=your_jwt_secret

# File Uploads
MAX_FILE_SIZE=5MB
UPLOAD_DIR=./public/uploads
```

## Project Structure

```
├── components/          # React components
│   ├── admin/          # Admin-specific components
│   ├── common/         # Shared components
│   └── ui/             # UI components
├── contexts/           # React context providers
├── hooks/              # Custom React hooks
├── layouts/            # Page layouts
├── lib/                # Core libraries and utilities
│   ├── config.ts       # Environment configuration
│   ├── urlHelpers.ts   # URL construction helpers
│   ├── db.ts           # Database connection
│   └── services/       # API services
├── pages/              # Next.js pages and API routes
│   ├── api/            # API endpoints
│   └── *.tsx           # Application pages
├── public/             # Static assets
│   └── uploads/        # User uploaded files
├── styles/             # Global styles
├── types/              # TypeScript type definitions
└── utils/              # Utility functions
```

## Recent Changes & Migrations

### BASE_URL Migration (Completed: 2026-01-20)

**What Changed**: Migrated all hardcoded `localhost:3001` URLs to environment-based configuration using `BASE_URL` from `.env.local`.

**Why**: The application is now a unified Next.js app running on port 3000 (previously had separate server on 3001). Environment-based URLs enable easy deployment to different environments (dev, staging, production).

**Key Files Created/Modified**:

1. **Infrastructure Files Created**:
   - `lib/config.ts` - Centralized environment configuration
   - `lib/urlHelpers.ts` - URL construction helper functions

2. **Helper Functions Available**:
   ```typescript
   import { getApiUrl, getFileUrl, getUploadUrl, getDeleteFileUrl, stripBaseUrl } from '@/lib/urlHelpers';

   // API endpoint URLs
   const url = getApiUrl('/api/profile/update');

   // File URLs (images, documents)
   const imageUrl = getFileUrl(profilePicturePath);

   // Upload URLs
   const uploadUrl = getUploadUrl('trainer', 'cv');

   // Delete file URLs
   const deleteUrl = getDeleteFileUrl(fileUrl);

   // Strip base URL from full URL
   const relativePath = stripBaseUrl(fullUrl);
   ```

3. **Files Updated** (30+ files):
   - All components in `components/` directory
   - All admin components in `components/admin/`
   - All layouts in `layouts/`
   - All API routes in `pages/api/`
   - Core services in `lib/services/`
   - Utility files in `utils/`

4. **Migration Pattern**:
   ```typescript
   // Before:
   const response = await fetch('http://localhost:3001/api/courses');
   const imageUrl = `http://localhost:3001${profilePicture}`;

   // After:
   import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
   const response = await fetch(getApiUrl('/api/courses'));
   const imageUrl = getFileUrl(profilePicture);
   ```

5. **Environment Configuration**:
   - `.env.local` - Local development (localhost:3000)
   - For production: Simply update `NEXT_PUBLIC_BASE_URL` and `BASE_URL` to your production domain
   - No code changes needed for different environments

**Files Migrated**:
- Components: ProfileView, CourseEditor, GradingView, TrainingProviderDashboard, CourseImage, AdminProfileCard, LearnerProfileCard, TrainerProfileCard, + others
- Admin Components: ClassDetailView, ClassManagementViews, CompletedClasses, CreateNewClassView, EnrollLearners, OngoingClasses, ViewTrainers
- Layouts: AdminLayout
- API Routes: All upload handlers, profile routes, training provider info
- Services: profileService, courseApiService
- Utils: imageUtils

**Syntax Fixes Applied**:
During migration, fixed multiple syntax errors:
- Fixed 6 instances of incomplete ternary operators with `stripBaseUrl` (ProfileView.tsx)
- Fixed 11 instances of missing closing parentheses in `getApiUrl()` calls across multiple files
- Fixed 6 instances where `fetch()` options were incorrectly passed to `getApiUrl()` instead of `fetch()`

**Common Issues Fixed**:
```typescript
// ❌ Wrong - fetch options passed to getApiUrl
await fetch(getApiUrl('/api/endpoint', { method: 'POST' }));

// ✅ Correct - fetch options passed to fetch
await fetch(getApiUrl('/api/endpoint'), { method: 'POST' });

// ❌ Wrong - missing closing parenthesis
await fetch(getApiUrl('/api/endpoint');

// ✅ Correct - properly closed
await fetch(getApiUrl('/api/endpoint'));

// ❌ Wrong - incomplete ternary
const path = url.startsWith('http') ? url; stripBaseUrl : url;

// ✅ Correct - proper function call
const path = url.startsWith('http') ? stripBaseUrl(url) || url : url;
```

**Verification**: All `localhost:3001` references removed from source code (verified 2026-01-20)

## User Roles

The system supports multiple user roles:
- **Admin**: System administration and oversight
- **Training Provider**: Course provider management
- **Trainer**: Course instruction and delivery
- **Learner**: Course enrollment and learning
- **Developer**: Additional role with specific permissions

## API Documentation

API routes are organized under `/pages/api/`:
- `/api/auth/*` - Authentication endpoints
- `/api/profile/*` - User profile management
- `/api/courses/*` - Course management
- `/api/admin/*` - Admin operations
- `/api/upload/*` - File upload handlers
- `/api/grading/*` - Grading and assessment

## File Uploads

Uploaded files are stored in `public/uploads/` with the following structure:
```
public/uploads/
├── admin/
├── trainer/
├── learner/
├── developer/
└── training-provider/
```

Each role has subdirectories for different file types (cv, certificates, profile pictures, etc.)

## Git Ignore

The `.gitignore` is configured to exclude:
- Build artifacts (`.next/`, `out/`)
- Dependencies (`node_modules/`)
- Environment files (`.env.local`)
- Upload directories (`public/uploads/`)
- IDE files

## Contributing

When making changes:
1. Always use environment-based URLs (via `lib/urlHelpers.ts`)
2. Never hardcode localhost URLs
3. Update TypeScript types when modifying data structures
4. Test with different user roles
5. Document significant changes in this README

## Notes

- The application previously ran as separate client (port 3000) and server (port 3001) but has been unified into a single Next.js application
- All API routes are now Next.js API routes under `/pages/api/`
- File uploads are handled server-side with Multer
- Database queries use the `pg` PostgreSQL client
