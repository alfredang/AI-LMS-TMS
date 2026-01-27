---
layout: default
title: Deployment
nav_order: 5
---

# Deployment Guide

Deploy AI-LMS-TMS to production environments.

---

## Vercel Deployment (Recommended)

Vercel provides the easiest deployment experience for Next.js applications.

### Prerequisites

- [Vercel Account](https://vercel.com/signup)
- GitHub repository connected to Vercel
- Supabase database configured

### Step 1: Connect Repository

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New Project"**
3. Import your GitHub repository: `AI-LMS-TMS`
4. Select the repository and click **Import**

### Step 2: Configure Environment Variables

In the Vercel project settings, add these environment variables:

```env
# Database
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-1-[region].pooler.supabase.com:6543/postgres

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co

# Application
NEXT_PUBLIC_BASE_URL=https://your-app.vercel.app

# SMTP Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com

# Google AI
NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY=your-api-key

# SSG API (Optional)
SSG_API_BASE_URL=https://api.ssg-wsg.sg
SSG_AUTH_TOKEN=your-token
SSG_ENCRYPTION_KEY=your-key
```

### Step 3: Deploy

1. Click **Deploy**
2. Wait for the build to complete
3. Your app is live at `https://your-app.vercel.app`

### Step 4: Configure Custom Domain (Optional)

1. Go to **Project Settings** > **Domains**
2. Add your custom domain
3. Configure DNS records as instructed

---

## Supabase Database Setup

### Create Project

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Click **New Project**
3. Choose organization and name
4. Set database password
5. Select region (closest to your users)

### Run Database Schema

1. Go to **SQL Editor** in Supabase
2. Copy contents of `database/01-schema.sql`
3. Run the query
4. Copy contents of `database/02-data-clean-fixed.sql` for seed data
5. Run the query

### Get Connection String

1. Go to **Settings** > **Database**
2. Copy the **Transaction Pooler** connection string (port 6543)
3. Replace `[YOUR-PASSWORD]` with your database password

```
postgresql://postgres.[ref]:[password]@aws-1-[region].pooler.supabase.com:6543/postgres
```

> **Important**: Use the Transaction Pooler URL for serverless deployments like Vercel.

---

## Manual Deployment

### Build for Production

```bash
# Install dependencies
npm install

# Build the application
npm run build

# Start production server
npm start
```

### Using PM2 (Process Manager)

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start npm --name "ai-lms-tms" -- start

# View logs
pm2 logs ai-lms-tms

# Restart
pm2 restart ai-lms-tms

# Stop
pm2 stop ai-lms-tms
```

### PM2 Ecosystem File

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'ai-lms-tms',
    script: 'npm',
    args: 'start',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
```

Run with:
```bash
pm2 start ecosystem.config.js --env production
```

---

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:18-alpine AS base

# Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT 3000

CMD ["node", "server.js"]
```

### Build and Run

```bash
# Build image
docker build -t ai-lms-tms .

# Run container
docker run -p 3000:3000 --env-file .env.local ai-lms-tms
```

### Docker Compose

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
      - NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}
    restart: unless-stopped
```

---

## Environment Configuration

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Configure production database URL
- [ ] Set correct `NEXT_PUBLIC_BASE_URL`
- [ ] Configure SMTP for production emails
- [ ] Set up SSL/HTTPS
- [ ] Configure CORS for your domain
- [ ] Remove debug/development code
- [ ] Set up monitoring and logging

### Security Considerations

1. **Database**: Use SSL connections
2. **Secrets**: Never commit `.env` files
3. **API Keys**: Rotate keys periodically
4. **CORS**: Restrict to your domains
5. **Rate Limiting**: Implement for API endpoints

---

## CI/CD with GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Vercel

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run type check
        run: npm run type-check

      - name: Run lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
```

---

## Monitoring

### Vercel Analytics

Enable Vercel Analytics in your project dashboard for:
- Page views and visitors
- Performance metrics
- Error tracking

### Error Monitoring

Consider integrating:
- [Sentry](https://sentry.io/) for error tracking
- [LogRocket](https://logrocket.com/) for session replay
- [Datadog](https://datadoghq.com/) for infrastructure monitoring

---

## Troubleshooting

### Build Failures

**Issue**: Build fails with TypeScript errors

```bash
# Check types locally first
npm run type-check
```

**Issue**: Missing environment variables

Ensure all required variables are set in Vercel dashboard.

### Runtime Errors

**Issue**: Database connection timeout

- Use Transaction Pooler URL (port 6543)
- Check Supabase project is active
- Verify IP allowlist if applicable

**Issue**: Email not sending

- Verify SMTP credentials
- Check Vercel logs for errors
- Test with a simpler email service first

### Performance Issues

- Enable Vercel caching
- Optimize images with next/image
- Use ISR for static content
- Monitor database query performance

---

## Scaling

### Horizontal Scaling

Vercel automatically scales serverless functions. For custom infrastructure:

- Use load balancer
- Deploy multiple instances
- Use Redis for session storage
- Configure database connection pooling

### Database Optimization

- Add database indexes
- Use connection pooling
- Consider read replicas
- Implement caching layer

---

[Back to Home](./)
