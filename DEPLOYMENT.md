# Deployment Guide - Vercel & Supabase

This guide walks you through deploying the AI-LMS-TMS application to Vercel with Supabase as the database.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Supabase Setup](#supabase-setup)
- [Vercel Deployment](#vercel-deployment)
- [Environment Variables](#environment-variables)
- [Database Migration](#database-migration)
- [Post-Deployment](#post-deployment)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have:
- A GitHub account (to connect with Vercel)
- A Vercel account ([sign up](https://vercel.com/signup))
- A Supabase account ([sign up](https://supabase.com))
- Git installed locally
- Node.js 18+ installed

## Supabase Setup

### 1. Create a New Supabase Project

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Click **"New Project"**
3. Fill in the project details:
   - **Name**: `ai-lms-tms` (or your preferred name)
   - **Database Password**: Create a strong password (save this!)
   - **Region**: Choose closest to your users
   - **Pricing Plan**: Start with Free tier
4. Click **"Create new project"**
5. Wait 2-3 minutes for project provisioning

### 2. Get Database Connection Details

Once your project is ready:

1. Go to **Project Settings** (gear icon in sidebar)
2. Navigate to **Database** section
3. Copy the following connection details:

   **Connection String (Session mode)**:
   ```
   postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
   ```

   **Individual Connection Details**:
   - Host: `aws-0-[region].pooler.supabase.com`
   - Database: `postgres`
   - Port: `5432`
   - User: `postgres.[project-ref]`
   - Password: Your database password

4. Save these details - you'll need them for environment variables

### 3. Configure Database Schema

You have two options to set up your database schema:

#### Option A: Using Supabase SQL Editor (Recommended)

1. In Supabase Dashboard, go to **SQL Editor**
2. Click **"New query"**
3. Copy your existing database schema from your local PostgreSQL
4. Paste and run the SQL to create all tables:

```sql
-- Example: Create your tables here
-- Copy from your existing database schema

CREATE TABLE IF NOT EXISTS auth_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add all your other tables...
-- courses, course_runs, enrolments, profiles, etc.
```

5. Click **"Run"** to execute

#### Option B: Using Database Migration Tool

1. Export your local database schema:
   ```bash
   pg_dump -U postgres -d ssg_lms_tms --schema-only > schema.sql
   ```

2. Connect to Supabase and import:
   ```bash
   psql "postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres" < schema.sql
   ```

### 4. Set Up Row Level Security (RLS) - Optional but Recommended

Supabase enables RLS by default. Configure policies based on your needs:

1. Go to **Authentication** > **Policies**
2. For each table, create policies for SELECT, INSERT, UPDATE, DELETE
3. Example policy for `courses` table:

```sql
-- Allow authenticated users to read courses
CREATE POLICY "Allow authenticated read access"
ON courses FOR SELECT
TO authenticated
USING (true);

-- Allow admins to manage courses
CREATE POLICY "Allow admin full access"
ON courses FOR ALL
TO authenticated
USING (
  auth.jwt() ->> 'role' = 'admin'
);
```

### 5. Enable Realtime (Optional)

If you want real-time updates:

1. Go to **Database** > **Replication**
2. Enable replication for tables you want to listen to
3. Click on each table and toggle **"Enable Realtime"**

## Vercel Deployment

### 1. Prepare Your Repository

1. Initialize git (if not already done):
   ```bash
   cd c:\Users\PC\Desktop\AI-LMS-TMS
   git init
   git add .
   git commit -m "Initial commit - ready for deployment"
   ```

2. Create a GitHub repository and push:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/ai-lms-tms.git
   git branch -M main
   git push -u origin main
   ```

### 2. Configure Build Settings

Create or verify `vercel.json` in your project root:

```json
{
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "framework": "nextjs",
  "regions": ["sin1"],
  "env": {
    "NEXT_PUBLIC_BASE_URL": "@vercel-url"
  }
}
```

### 3. Deploy to Vercel

#### Option A: Deploy via Vercel Dashboard (Easiest)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New..."** > **"Project"**
3. Import your GitHub repository
4. Configure project:
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `./` (leave default)
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `.next` (auto-detected)

5. Click **"Deploy"** (don't add env vars yet, we'll do this next)

#### Option B: Deploy via Vercel CLI

1. Install Vercel CLI:
   ```bash
   npm install -g vercel
   ```

2. Login to Vercel:
   ```bash
   vercel login
   ```

3. Deploy:
   ```bash
   vercel
   ```

4. Follow the prompts:
   - Set up and deploy? **Y**
   - Which scope? Select your account
   - Link to existing project? **N**
   - Project name? `ai-lms-tms`
   - In which directory? `./`
   - Want to override settings? **N**

5. For production deployment:
   ```bash
   vercel --prod
   ```

### 4. Configure Environment Variables in Vercel

1. In Vercel Dashboard, go to your project
2. Click **"Settings"** > **"Environment Variables"**
3. Add the following variables:

#### Database Variables
```env
DB_HOST=aws-0-[region].pooler.supabase.com
DB_PORT=5432
DB_USER=postgres.[project-ref]
DB_PASSWORD=your_supabase_password
DB_NAME=postgres
DB_SSL=true
```

#### Application URLs
```env
NEXT_PUBLIC_BASE_URL=https://your-app.vercel.app
BASE_URL=https://your-app.vercel.app
```

#### JWT Secret
```env
JWT_SECRET=your_production_jwt_secret_min_32_characters
```

#### File Upload Configuration
```env
MAX_FILE_SIZE=5MB
UPLOAD_DIR=./public/uploads
```

#### SSG API Configuration (if using)
```env
SSG_API_BASE_URL=https://api.ssg-wsg.sg
SSG_API_VERSION=v1
```

#### Google Gemini API (if using)
```env
NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY=your_gemini_api_key
```

#### Logging
```env
LOG_LEVEL=info
NODE_ENV=production
```

4. For each variable, select the environment:
   - ✅ **Production**
   - ✅ **Preview** (optional)
   - ✅ **Development** (optional)

5. Click **"Save"**

### 5. Redeploy with Environment Variables

After adding environment variables:

1. Go to **"Deployments"** tab
2. Click the **⋯** menu on latest deployment
3. Click **"Redeploy"**
4. Check **"Use existing Build Cache"**
5. Click **"Redeploy"**

## Environment Variables

### Complete Environment Variables Reference

Create this structure for different environments:

#### `.env.local` (Local Development)
```env
# Database (Local PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_local_password
DB_NAME=ssg_lms_tms
DB_SSL=false

# Application URLs
NEXT_PUBLIC_BASE_URL=http://localhost:3000
BASE_URL=http://localhost:3000

# JWT Secret
JWT_SECRET=your_local_jwt_secret_for_development

# File Upload
MAX_FILE_SIZE=5MB
UPLOAD_DIR=./public/uploads

# Logging
LOG_LEVEL=debug
NODE_ENV=development
```

#### `.env.production` (Vercel Production)
```env
# Database (Supabase)
DB_HOST=aws-0-[region].pooler.supabase.com
DB_PORT=5432
DB_USER=postgres.[project-ref]
DB_PASSWORD=your_supabase_password
DB_NAME=postgres
DB_SSL=true

# Application URLs
NEXT_PUBLIC_BASE_URL=https://your-app.vercel.app
BASE_URL=https://your-app.vercel.app

# JWT Secret (Generate strong secret)
JWT_SECRET=production_secret_min_32_chars_random_string

# File Upload
MAX_FILE_SIZE=5MB
UPLOAD_DIR=./public/uploads

# SSG API
SSG_API_BASE_URL=https://api.ssg-wsg.sg
SSG_API_VERSION=v1

# Logging
LOG_LEVEL=info
NODE_ENV=production
```

### Generate Strong JWT Secret

Use one of these methods:

```bash
# Method 1: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Method 2: Using OpenSSL
openssl rand -hex 32

# Method 3: Online generator
# Visit: https://generate-secret.vercel.app/32
```

## Database Migration

### Update Database Connection for Supabase

Update `lib/db.ts` to support SSL connections:

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export default pool;
```

### Migrate Data from Local to Supabase

If you have existing data:

1. **Export data from local database**:
   ```bash
   pg_dump -U postgres -d ssg_lms_tms --data-only --inserts > data.sql
   ```

2. **Import to Supabase**:
   ```bash
   psql "postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres" < data.sql
   ```

## Post-Deployment

### 1. Verify Deployment

1. Visit your Vercel URL: `https://your-app.vercel.app`
2. Check that the app loads without errors
3. Test key functionality:
   - User registration/login
   - Profile viewing
   - Course browsing
   - File uploads (if applicable)

### 2. Set Up Custom Domain (Optional)

1. In Vercel Dashboard, go to **"Settings"** > **"Domains"**
2. Click **"Add"**
3. Enter your domain: `your-domain.com`
4. Follow DNS configuration instructions:
   - Add A record or CNAME record as shown
   - Wait for DNS propagation (5-60 minutes)
5. Enable **"Automatic HTTPS"** (Vercel does this automatically)

### 3. Configure File Uploads for Production

Since Vercel's file system is ephemeral, consider using cloud storage:

#### Option A: Vercel Blob Storage

1. Install Vercel Blob:
   ```bash
   npm install @vercel/blob
   ```

2. Enable in Vercel Dashboard:
   - Go to **Storage** tab
   - Click **"Create Database"**
   - Select **"Blob"**

3. Update upload handlers to use Vercel Blob

#### Option B: Supabase Storage

1. In Supabase Dashboard, go to **Storage**
2. Create a bucket: `uploads`
3. Set bucket policies (public/private)
4. Update upload handlers:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Upload file
const { data, error } = await supabase.storage
  .from('uploads')
  .upload(`${role}/${fileType}/${fileName}`, file);
```

#### Option C: AWS S3 / Cloudinary

Configure third-party cloud storage service

### 4. Monitor Your Application

1. **Vercel Analytics** (Free):
   - Go to **Analytics** tab in Vercel
   - View page views, performance metrics

2. **Vercel Logs**:
   - Go to **Deployments** > Click deployment
   - View **Runtime Logs** for errors

3. **Supabase Logs**:
   - Go to **Logs** in Supabase Dashboard
   - Monitor database queries and errors

### 5. Set Up Automatic Deployments

Vercel automatically deploys when you push to GitHub:

1. **Production**: Push to `main` branch
   ```bash
   git push origin main
   ```

2. **Preview**: Create pull request or push to other branches
   ```bash
   git checkout -b feature/new-feature
   git push origin feature/new-feature
   ```

## Troubleshooting

### Common Issues

#### 1. Database Connection Errors

**Error**: `Error: connect ETIMEDOUT` or `SSL connection error`

**Solution**:
- Verify `DB_SSL=true` in environment variables
- Check Supabase project is active (not paused)
- Verify connection string is correct
- Update `lib/db.ts` to handle SSL:

```typescript
ssl: process.env.DB_SSL === 'true' ? {
  rejectUnauthorized: false
} : false
```

#### 2. Environment Variables Not Loading

**Error**: `undefined` values for environment variables

**Solution**:
- Ensure variables are prefixed with `NEXT_PUBLIC_` for client-side access
- Redeploy after adding environment variables
- Clear build cache and redeploy

#### 3. Build Failures

**Error**: Build fails on Vercel

**Solution**:
- Check build logs in Vercel dashboard
- Ensure all dependencies are in `package.json`
- Verify TypeScript has no errors: `npm run build` locally
- Check Node.js version matches Vercel (18.x)

#### 4. File Upload Issues

**Error**: Files not persisting after deployment

**Solution**:
- Vercel's filesystem is read-only in production
- Must use Vercel Blob, Supabase Storage, or S3
- See [Configure File Uploads](#3-configure-file-uploads-for-production)

#### 5. API Route Timeouts

**Error**: `FUNCTION_INVOCATION_TIMEOUT`

**Solution**:
- Vercel Hobby plan has 10s timeout
- Upgrade to Pro for 60s timeout
- Optimize database queries
- Add indexes to frequently queried columns

### Getting Help

- **Vercel Docs**: https://vercel.com/docs
- **Supabase Docs**: https://supabase.com/docs
- **Next.js Docs**: https://nextjs.org/docs
- **Community Support**:
  - Vercel Discord: https://vercel.com/discord
  - Supabase Discord: https://supabase.com/discord

## Security Checklist

Before going to production:

- [ ] Change all default passwords
- [ ] Generate strong JWT secret (32+ characters)
- [ ] Enable SSL for database connections
- [ ] Set up Supabase Row Level Security policies
- [ ] Review and restrict API endpoint access
- [ ] Enable CORS only for your domain
- [ ] Remove debug logging from production
- [ ] Set up rate limiting (using Vercel Edge Config or Upstash)
- [ ] Enable Vercel's Security Headers
- [ ] Review file upload size limits
- [ ] Set up monitoring and alerts

## Next Steps

After successful deployment:

1. Set up monitoring with [Sentry](https://sentry.io) or [LogRocket](https://logrocket.com)
2. Configure backup strategy for Supabase database
3. Set up CI/CD pipeline with GitHub Actions
4. Configure staging environment for testing
5. Implement feature flags using Vercel Edge Config
6. Add performance monitoring
7. Set up error tracking

---

**Need Help?** Review the main [README.md](README.md) for application-specific documentation.
