---
layout: default
title: Getting Started
---

# Getting Started

This guide will help you set up AI-LMS-TMS on your local machine for development.

[Back to Home](./)

---

## Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** - [Download](https://nodejs.org/)
- **PostgreSQL 17+** or a [Supabase](https://supabase.com/) account
- **npm** or **yarn** package manager
- **Git** for version control

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/alfredang/AI-LMS-TMS.git
cd AI-LMS-TMS
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env.local` file in the root directory:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your configuration:

```env
# Database Connection (Supabase Transaction Pooler)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-1-[region].pooler.supabase.com:6543/postgres

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co

# Application URLs
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# SMTP Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com

# Google Gemini AI (for chatbot)
NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY=your-gemini-api-key
```

### 4. Set Up the Database

If using Supabase, run the schema in the SQL Editor:

```bash
# Or run locally with psql
psql -d your_database -f database/01-schema.sql
psql -d your_database -f database/02-data-clean-fixed.sql
```

### 5. Start Development Server

```bash
npm run dev
```

The application will be available at **http://localhost:3000**

---

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_BASE_URL` | Application base URL | `http://localhost:3000` |

### Email Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `SMTP_HOST` | SMTP server host | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username/email | `your-email@gmail.com` |
| `SMTP_PASS` | SMTP password/app password | `xxxx xxxx xxxx xxxx` |
| `SMTP_FROM` | Sender email address | `your-email@gmail.com` |

### AI Configuration

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY` | Google AI API key for Gemini chatbot |

### SSG API Integration (Optional)

| Variable | Description |
|----------|-------------|
| `SSG_API_BASE_URL` | SSG API base URL |
| `SSG_AUTH_TOKEN` | SSG API bearer token |
| `SSG_ENCRYPTION_KEY` | AES-256 encryption key for SSG |

---

## Gmail App Password Setup

To use Gmail for sending OTP emails:

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification**
3. Go to **App passwords**
4. Select "Mail" and "Other (Custom name)"
5. Enter "AI-LMS-TMS" as the name
6. Copy the 16-character password to `SMTP_PASS`

---

## Test Accounts

After running the seed data, you can login with these test accounts:

| Email | Role | Password |
|-------|------|----------|
| `admin@tertiaryinfotech.com` | Admin | `password123` |
| `trainer@tertiaryinfotech.com` | Trainer | `password123` |
| `learner@tertiaryinfotech.com` | Learner | `password123` |

---

## Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run type-check   # Run TypeScript type checking
```

---

## Troubleshooting

### Database Connection Issues

**Error**: `ECONNREFUSED` or `ETIMEDOUT`

**Solution**:
- Check your `DATABASE_URL` is correct
- Ensure Supabase project is active
- Use Transaction Pooler URL (port 6543) for serverless

### Email Not Sending

**Error**: OTP emails not received

**Solution**:
- Verify SMTP credentials are correct
- Check spam/junk folder
- Ensure Gmail App Password is set up correctly
- Check server logs for email sending status

### Build Errors

**Error**: TypeScript errors during build

**Solution**:
```bash
npm run type-check  # Identify type errors
npm run lint        # Fix linting issues
```

---

## Next Steps

- [Explore Features](./features) - Learn about all features
- [API Reference](./api-reference) - Integrate with the API
- [Deployment Guide](./deployment) - Deploy to production

---

[Back to Home](./)
