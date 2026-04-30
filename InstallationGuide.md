# Installation Guide — LMS/TMS New Client Deployment

Deploy the LMS/TMS platform for a new client on a fresh Hostinger VPS with Coolify, using Docker Compose.

**Architecture:** Same codebase, separate database per client (like n8n). All client-specific config is driven by environment variables and the `training_provider` database table — no code fork needed.

---

## Table of Contents

1. [Prerequisites](#step-1-prerequisites)
2. [Provision a Hostinger VPS](#step-2-provision-a-hostinger-vps)
3. [Install Coolify on the VPS](#step-3-install-coolify-on-the-vps)
4. [Point the Client's Domain to Hostinger](#step-4-point-the-clients-domain-to-hostinger)
5. [Create a Docker Compose Project in Coolify](#step-5-create-a-docker-compose-project-in-coolify)
6. [Set Environment Variables](#step-6-set-environment-variables)
7. [Configure the Domain in Coolify](#step-7-configure-the-domain-in-coolify)
8. [Deploy](#step-8-deploy)
9. [First Boot — What Happens Automatically](#step-9-first-boot--what-happens-automatically)
10. [Post-Deployment Configuration (Admin UI)](#step-10-post-deployment-configuration-admin-ui)
11. [Verification Checklist](#step-11-verification-checklist)
12. [Quick Reference: Minimum Viable Deployment](#quick-reference-minimum-viable-deployment)
13. [Database Tables Reference](#database-tables-reference)
14. [Docker Volumes Reference](#docker-volumes-reference)
15. [Backup Recommendations](#backup-recommendations)
16. [Troubleshooting](#troubleshooting)
17. [Appendix A: Gmail OAuth Setup (Detailed)](#appendix-a-gmail-oauth-setup-detailed)
18. [Appendix B: SSG TPGateway Certificate Setup (Detailed)](#appendix-b-ssg-tpgateway-certificate-setup-detailed)

---

## Step 1: Prerequisites

Before you begin, ensure you have:

- [ ] A **Hostinger VPS** plan (KVM 2 or higher recommended — at least 4 GB RAM, 2 vCPU, 80 GB SSD)
- [ ] A **domain name** for the client (e.g., `lms.clientcompany.com`)
- [ ] Access to the **DNS settings** of the client's domain (at their registrar or Cloudflare)
- [ ] A **GitHub account** with access to the LMS/TMS repository
- [ ] A **GitHub Personal Access Token** (for Coolify to pull the private repo)
  - Go to GitHub > Settings > Developer settings > Personal access tokens > Tokens (classic)
  - Generate new token with `repo` scope
  - Save it securely — you'll need it in Step 5

---

## Step 2: Provision a Hostinger VPS

1. Log in to [Hostinger](https://www.hostinger.com/) and go to **VPS** section
2. Purchase or provision a new VPS:
   - **OS:** Ubuntu 22.04 or 24.04 LTS
   - **Plan:** KVM 2 or higher (4 GB RAM minimum)
   - **Location:** Choose the region closest to the client's users
3. Once provisioned, note down:
   - **Server IP Address** (e.g., `154.41.250.123`)
   - **Root Password** (or set up SSH keys)
4. **SSH into the server** to verify access:
   ```bash
   ssh root@154.41.250.123
   ```
5. **(Recommended) Update the server:**
   ```bash
   apt update && apt upgrade -y
   ```
6. **(Recommended) Set the hostname** to something identifiable:
   ```bash
   hostnamectl set-hostname lms-clientname
   ```

---

## Step 3: Install Coolify on the VPS

Coolify is a self-hosted PaaS (like Heroku/Vercel). It manages Docker deployments, SSL certificates, and more.

1. **SSH into the VPS** (if not already connected):
   ```bash
   ssh root@154.41.250.123
   ```

2. **Run the Coolify installer** (one command):
   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
   ```
   This installs Docker, Docker Compose, and Coolify. It takes 2-5 minutes.

3. **Wait for the installation to complete.** You'll see a message like:
   ```
   Coolify installed successfully!
   Please visit http://154.41.250.123:8000 to get started.
   ```

4. **Open Coolify in your browser:**
   ```
   http://<server-ip>:8000
   ```

5. **Create your Coolify admin account:**
   - Enter your email and a strong password
   - This is the Coolify admin panel, not the LMS admin

6. **Complete the initial setup wizard:**
   - Coolify will detect the localhost server automatically
   - Click **"Localhost"** as the server to use
   - Coolify will verify Docker is running

> **Tip:** Bookmark `http://<server-ip>:8000` — this is your Coolify dashboard for managing deployments.

---

## Step 4: Point the Client's Domain to Hostinger

You need to create a DNS record so the client's domain points to the Hostinger VPS IP address.

### Option A: Client uses their own domain registrar (GoDaddy, Namecheap, etc.)

1. Log in to the domain registrar's DNS management panel
2. **Add an A record:**
   - **Type:** `A`
   - **Host / Name:** `lms` (if using subdomain like `lms.clientcompany.com`) or `@` (if using root domain)
   - **Value / Points to:** `154.41.250.123` (the Hostinger VPS IP)
   - **TTL:** `300` (5 minutes, or Auto)
3. If using a root domain, also add a **www** record:
   - **Type:** `CNAME`
   - **Host / Name:** `www`
   - **Value / Points to:** `clientcompany.com`

#### Worked example — GoDaddy → Hostinger Coolify (IP `76.13.209.134`)

Use this when the client's domain is registered at GoDaddy and the LMS/TMS Coolify instance is running on the Hostinger VPS at `76.13.209.134`. The example assumes you want the LMS at `lms.clientcompany.com`.

1. **Log in to GoDaddy** at <https://sso.godaddy.com/> with the account that owns the domain.
2. Open the **Products** page → find the domain (`clientcompany.com`) → click **DNS** (or **Manage DNS**). The **DNS Management** page opens, listing the existing records (NS, SOA, default A/CNAME entries, etc.).
3. In the **Records** table, click **Add New Record**. Fill in:

   | Field | Value |
   |---|---|
   | **Type** | `A` |
   | **Name** | `lms` &nbsp;(just the subdomain — GoDaddy appends the apex automatically) |
   | **Value** | `76.13.209.134` |
   | **TTL** | `600 seconds` (or `1 Hour`) — pick the lowest GoDaddy lets you use while testing |

   Click **Save**.

4. **(Only if pointing the apex `clientcompany.com` instead of a subdomain)** edit the existing root `A` record (Name `@`) and change its **Value** to `76.13.209.134`. Then add a CNAME so `www` follows the apex:

   | Field | Value |
   |---|---|
   | **Type** | `CNAME` |
   | **Name** | `www` |
   | **Value** | `@` &nbsp;(GoDaddy resolves this to the apex) |
   | **TTL** | `1 Hour` |

   Do **not** delete GoDaddy's NS or SOA records. Leave the existing email-related MX/TXT records alone unless the client is also moving mail.

5. Wait 2–10 minutes for GoDaddy's DNS to propagate, then verify from your local machine:

   ```bash
   dig lms.clientcompany.com +short
   # expected output:
   # 76.13.209.134
   ```

   If you see anything else (e.g., a parked-domain IP), wait a few more minutes and retry — GoDaddy occasionally takes longer for first-time records.

6. Once `dig` returns `76.13.209.134`, continue to [Step 7](#step-7-configure-the-domain-in-coolify) and set the domain in Coolify so Let's Encrypt can issue the SSL certificate.

> **Tip:** GoDaddy's UI sometimes shows two A records for the same name during propagation — the old one and the one you just added. Delete the stale entry once the new one is live so the resolver doesn't round-robin between them.

### Option B: Client uses Cloudflare

1. Log in to Cloudflare > select the domain
2. Go to **DNS** > **Records**
3. Click **Add Record:**
   - **Type:** `A`
   - **Name:** `lms` (or `@` for root domain)
   - **IPv4 Address:** `154.41.250.123`
   - **Proxy status:** Toggle **OFF** (DNS only / grey cloud) — Let Coolify handle SSL, not Cloudflare
   - **TTL:** Auto
4. Click **Save**

### Verify DNS Propagation

Wait 2-10 minutes, then verify the DNS is working:

```bash
# From your local terminal
nslookup lms.clientcompany.com
# Should return the VPS IP: 154.41.250.123

# Or use dig
dig lms.clientcompany.com +short
# Should return: 154.41.250.123
```

> **Important:** DNS propagation can take up to 48 hours in rare cases, but usually completes within 5-15 minutes. Do not proceed to Coolify domain configuration until DNS is resolving correctly, otherwise SSL certificate generation will fail.

---

## Step 5: Create a Docker Compose Project in Coolify

1. **Open Coolify** at `http://<server-ip>:8000`

2. **Create a new Project:**
   - Click **"Projects"** in the left sidebar
   - Click **"+ Add"**
   - Name it (e.g., `Client Name LMS`)
   - Click **"Save"**

3. **Add a new Environment** (or use the default "Production"):
   - Click into the project
   - Click **"+ New Resource"**

4. **Select resource type: "Docker Compose"**

5. **Connect to GitHub repository:**
   - **Repository:** Select or paste the LMS/TMS GitHub repo URL
   - If the repo is private, you'll need to add a GitHub App or use a **Deploy Key**:
     - Go to **Coolify > Sources** (or Settings > GitHub)
     - Add a new GitHub App or paste the Personal Access Token from Step 1
   - **Branch:** `main`
   - **Docker Compose Location:** `docker-compose.yml` (default, at repo root)

6. Click **"Save"** — do NOT deploy yet. We need to set environment variables first.

---

## Step 6: Set Environment Variables

In the Coolify resource you just created, go to the **"Environment Variables"** tab.

### 6.1 Required Variables (must set before first deploy)

Add each of these as a separate environment variable:

| Variable | Value | Notes |
|---|---|---|
| `DB_PASSWORD` | `<generate-strong-password>` | Use a random 32+ character string. Example: `openssl rand -hex 16` |
| `DB_NAME` | `lmsdb` | Database name |
| `NODE_ENV` | `production` | Required for production mode |
| `NEXT_PUBLIC_BASE_URL` | `https://lms.clientcompany.com` | The client's full domain with `https://` |
| `JWT_SECRET` | `<generate-random-64-char-string>` | For JWT auth. Example: `openssl rand -hex 32` |
| `ADMIN_EMAIL` | `admin@clientcompany.com` | First admin account email |
| `ADMIN_PASSWORD` | `<strong-temp-password>` | First admin password (user changes on first login) |
| `ADMIN_FULL_NAME` | `System Admin` | Display name for the admin |
| `COMPANY_NAME` | `Client Company Pte Ltd` | The client's company name |
| `TRAINING_PARTNER_UEN` | `202412345X` | Singapore UEN (9+ characters), or placeholder if not SG |

> **How to generate secure values:**
> ```bash
> # Generate a strong DB password
> openssl rand -hex 16
> # Output example: a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5
>
> # Generate a JWT secret
> openssl rand -hex 32
> # Output example: 1a2b3c4d5e6f...64 characters
> ```

### 6.2 Required for Email (OTP won't work without this)

Email is configured **after first login** via the Admin UI (Training Provider > Company Settings > Integrations). You enter:
- Gmail OAuth Client ID
- Gmail OAuth Client Secret
- Gmail OAuth Refresh Token
- Sender email address

**No env vars needed** — credentials are stored in the `training_provider` table.

> **Alternative: SMTP fallback** (if not using Gmail OAuth):
>
> | Variable | Value |
> |---|---|
> | `SMTP_HOST` | `smtp.gmail.com` |
> | `SMTP_PORT` | `587` |
> | `SMTP_USER` | `client-email@gmail.com` |
> | `SMTP_PASS` | `<gmail-app-password>` |
> | `SMTP_FROM` | `client-email@gmail.com` |

### 6.3 Required for AI Features

| Variable | Value | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | For Nemo AI Agent, CP Generator, Courseware Generator |
| `GOOGLE_GEMINI_API_KEY` | `<gemini-key>` | For the public chatbot |
| `NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY` | `<same-gemini-key>` | Client-side access to Gemini |

> **Note:** These can also be configured later in the Admin UI under **Training Provider > API Keys**.

### 6.4 Optional (enable as needed later)

These can be added any time after deployment:

| Variable | Purpose |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Google Calendar, Drive, Gmail integration |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Google API persistent access |
| `GOOGLE_DRIVE_FOLDER_ID` | Google Drive folder for uploads |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account for Drive/Sheets |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service account JSON private key |
| `QBO_CLIENT_ID` | QuickBooks invoicing |
| `QBO_CLIENT_SECRET` | QuickBooks OAuth |
| `QBO_REALM_ID` | QuickBooks company ID |
| `QBO_REFRESH_TOKEN` | QuickBooks API access |
| `SSG_API_BASE_URL` | SkillsFuture Singapore (SG only) |
| `OPENCLAW_GATEWAY_URL` | Nemo AI backend gateway |
| `OPENCLAW_GATEWAY_TOKEN` | Nemo AI authentication |

---

## Step 7: Configure the Domain in Coolify

Now that DNS is pointing to the VPS and env vars are set, configure the domain in Coolify.

1. **In your Coolify resource**, click the **`app`** service (the Next.js application — not the `db` service)

2. Go to the **"General"** or **"Settings"** tab

3. **Set the domain:**
   - In the **"Domains"** field, enter: `https://lms.clientcompany.com`
   - Make sure to include `https://`

4. **Port mapping:**
   - Coolify's proxy should forward to port **3000** (the internal Next.js port)
   - The `docker-compose.yml` maps `3003:3000`, but Coolify's reverse proxy connects to the Docker network directly on port `3000`

5. **SSL Certificate:**
   - Coolify automatically provisions a **Let's Encrypt SSL certificate** when you set an `https://` domain
   - Ensure **"Force HTTPS"** is enabled (usually on by default)
   - The certificate auto-renews every 90 days

6. **For the `db` service:**
   - Do NOT set a domain on the database service
   - The database should NOT be publicly accessible
   - If you need external DB access (e.g., for debugging), use the mapped port `6434` with firewall rules

7. Click **"Save"**

---

## Step 8: Deploy

1. In the Coolify resource, click the **"Deploy"** button (top right)

2. Coolify will:
   - Pull the latest code from the GitHub `main` branch
   - Run `docker compose build` (builds the Next.js app image — takes 5-10 minutes on first build)
   - Run `docker compose up` (starts both the app and database containers)

3. **Monitor the build logs** in Coolify's deployment view:
   - Look for `✅ Connected to PostgreSQL database` in the app logs
   - Look for `✅ Scheduler initialized` — confirms the cron scheduler is running
   - Look for `Default admin created: admin@clientcompany.com` — confirms the init script ran

4. **First build takes 5-10 minutes** because it:
   - Downloads Node.js dependencies (`npm ci`)
   - Builds the Next.js app (`npm run build`)
   - Installs Python + Playwright + Chromium (for PDF generation)
   - Downloads the PostgreSQL 17 image

5. Subsequent deployments are faster (2-3 minutes) due to Docker layer caching.

---

## Step 9: First Boot — What Happens Automatically

**No manual database setup is needed.** Docker Compose creates and initialises everything on first deploy.

### Automatic sequence:

```
1. PostgreSQL container starts
   ├── Detects empty postgres_data volume
   ├── Creates database "lmsdb" (from POSTGRES_DB env var)
   ├── Creates user "postgres" with DB_PASSWORD
   ├── Runs database/01-schema.sql
   │   └── Creates all ~40 tables, types, indexes, constraints
   └── Runs database/02-init-admin.sql
       ├── Creates training_provider record (company name, UEN)
       ├── Creates protected admin user (all roles assigned)
       └── Links admin user to training provider

2. Next.js app container starts (waits for DB health check)
   ├── Connects to PostgreSQL
   ├── Runs auto-migrations (idempotent, IF NOT EXISTS)
   ├── Initialises task scheduler (cron jobs)
   └── Starts listening on port 3000

3. Coolify reverse proxy routes https://lms.clientcompany.com → port 3000
```

### After boot:
- The admin can log in at `https://lms.clientcompany.com`
- The login screen shows the company name set via `COMPANY_NAME` env var
- The admin will be prompted to change the default password on first login (if `force_first_password_change` is enabled)

> **Important:** The database init scripts only run **once** — when the `postgres_data` volume is empty. On subsequent restarts and redeploys, existing data is preserved. To start completely fresh, delete the `postgres_data` volume in Coolify and redeploy.

---

## Step 10: Post-Deployment Configuration (Admin UI)

After the admin logs in and changes the default password, configure these in **Training Provider > Company Settings**.

### 10.1 Branding & Identity

| Setting | Purpose | Where it appears |
|---|---|---|
| Company Name | Full legal name | Emails, certificates, invoices |
| Company Short Name | Abbreviated name | Login screen, email footer, SMS |
| Company Logo | Upload logo image | Login screen top |
| Company Address | Physical address | Help page, email templates, calendar events |
| Company Tel | Phone number | Help page, email footers, WhatsApp links |
| Company Email | Main contact email | System notifications |
| Support Email | Support contact | Ticket notifications, email reply-to |
| Color Scheme | UI theme colors | Entire application |
| Privacy Policy | Legal text | Login screen modal |
| Acceptable Use Policy | Legal text | Login screen modal |

### 10.2 Email Configuration (Critical)

| Setting | Purpose |
|---|---|
| Email User | The Gmail address used as the sender (e.g., `admin@clientcompany.com`) |
| Google Client ID | OAuth Client ID from Google Cloud Console |
| Google Client Secret | OAuth Client Secret from Google Cloud Console |
| Google Refresh Token | Long-lived token from OAuth flow |
| OTP Email Template | Custom subject and body for OTP verification emails |
| Certificate Email Template | Custom email for certificate delivery |

> **How to get Gmail OAuth credentials:**
> 1. Go to [Google Cloud Console](https://console.cloud.google.com/)
> 2. Create a new project (or use existing)
> 3. Enable the **Gmail API**
> 4. Go to **Credentials** > **Create Credentials** > **OAuth 2.0 Client ID**
> 5. Application type: **Web application**
> 6. Authorized redirect URIs: `https://developers.google.com/oauthplayground`
> 7. Copy the **Client ID** and **Client Secret**
> 8. Go to [OAuth Playground](https://developers.google.com/oauthplayground/)
> 9. Click the gear icon (top right) > check **"Use your own OAuth credentials"**
> 10. Enter your Client ID and Client Secret
> 11. In Step 1, select **Gmail API v1** > `https://mail.google.com/`
> 12. Click **Authorize APIs** > sign in with the sender Gmail account
> 13. In Step 2, click **Exchange authorization code for tokens**
> 14. Copy the **Refresh Token**
> 15. Enter all three values in Company Settings > Integrations

### 10.3 Google Integration (Optional)

| Setting | Purpose |
|---|---|
| Google Calendar ID | Sync class schedules to Google Calendar |
| Google Drive Folder URLs | Certificate storage, file uploads |
| Google Slides Template ID | Template for auto-generated certificates |
| Sync Google Calendar toggle | Enable/disable calendar sync |

### 10.4 Financial Settings

| Setting | Purpose |
|---|---|
| GST Registration, GST Rate | Tax calculations for invoices |
| Normal / Enhanced Fund Rates | SkillsFuture funding rate calculations |

### 10.5 Feature Toggles

| Setting | Purpose |
|---|---|
| Enable OTP Login | Allow passwordless login via email OTP |
| Enable Default OTP | Use a fixed OTP for testing (disable in production) |
| Force First Password Change | Require new users to change default password |
| Default Password | Password assigned to newly created user accounts |
| Enable Leaderboard / Point System | Gamification features |
| Auto-send toggles | Proforma invoices, confirmation emails, certificates, etc. |

### 10.6 SSG/TPGateway (Singapore training providers only)

| Setting | Purpose |
|---|---|
| SSG Default App | Which SSG application (app1/app3/app4) |
| SSG Certificate Files | Self-signed certs for TPGateway API |
| App4 Client ID / Secret | OAuth credentials for SSG App 4 |

---

## Step 11: Verification Checklist

After deployment, go through this checklist:

### Basic Functionality
- [ ] `https://lms.clientcompany.com` loads the login screen
- [ ] Login screen shows the client's company name
- [ ] SSL certificate is valid (green padlock in browser)
- [ ] Admin can log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- [ ] Force password change prompt appears on first login
- [ ] After password change, admin sees the dashboard

### Email & OTP
- [ ] Gmail OAuth credentials entered in Company Settings > Integrations
- [ ] OTP email sending works (test login with OTP)
- [ ] OTP email arrives within 30 seconds (check spam if not)

### File Uploads
- [ ] File uploads work (test uploading a profile picture)
- [ ] Uploaded files persist after container restart

### System Services
- [ ] Scheduler is running (check container logs for `"Scheduler initialized"`)
- [ ] AI features work (Nemo chat responds, if `ANTHROPIC_API_KEY` is set)

### Optional Integrations
- [ ] Google Calendar sync works (if configured)
- [ ] Certificate generation works (if Google Slides template configured)
- [ ] QuickBooks invoice sync works (if configured)

---

## Quick Reference: Minimum Viable Deployment

For the fastest path to a working instance, you only need these 10 env vars:

```bash
DB_PASSWORD=<openssl rand -hex 16>
DB_NAME=lmsdb
NODE_ENV=production
NEXT_PUBLIC_BASE_URL=https://lms.newclient.com
JWT_SECRET=<openssl rand -hex 32>
ADMIN_EMAIL=admin@newclient.com
ADMIN_PASSWORD=TempPassword123!
ADMIN_FULL_NAME=Admin
COMPANY_NAME=New Client Pte Ltd
TRAINING_PARTNER_UEN=202412345X
```

Everything else (Gmail, Google Calendar, QuickBooks, SSG, AI) can be configured later through the Admin UI or by adding env vars.

---

## Database Tables Reference

| Table | Purpose |
|---|---|
| `training_provider` | Master config — company info, branding, feature flags, integration credentials |
| `training_provider_api` | API keys (Anthropic, Gemini, etc.) per provider |
| `app_user` | All user accounts (admins, trainers, learners, etc.) |
| `user_role_map` | Role assignments per user (Learner, Trainer, Admin, Developer, Training Provider, Finance) |
| `course` / `course_run` / `course_session` | Course lifecycle management |
| `enrollment` | Learner registrations |
| `scheduler_config` | Cron job configuration |
| `otp_codes` | OTP tokens for passwordless login |
| `support_ticket` | Help desk tickets from learners |
| `certification` | Certificates issued to learners |

---

## Docker Volumes Reference

| Volume | Container Path | Purpose | Backup? |
|---|---|---|---|
| `postgres_data` | `/var/lib/postgresql/data` | Database persistence | Yes (critical) |
| `uploads_data` | `/app/public/uploads` | User-uploaded files (assessments, slides, images, etc.) | Yes |
| `nemo_data` | `/app/data` | Nemo AI memory and session data | Optional |

---

## Backup Recommendations

### Database (Critical)
Schedule regular `pg_dump` backups. You can run this from inside the container:
```bash
# SSH into the VPS, then:
docker exec <postgres-container-name> pg_dump -U postgres lmsdb > backup_$(date +%Y%m%d).sql
```

### File Uploads
Back up the `uploads_data` volume:
```bash
docker cp <app-container-name>:/app/public/uploads ./uploads_backup_$(date +%Y%m%d)
```

### Environment Variables
Keep a secure copy of all env vars (especially `DB_PASSWORD`, `JWT_SECRET`, API keys).

### Automated Backups
Consider setting up a cron job on the VPS for daily backups:
```bash
# Add to crontab (crontab -e):
0 2 * * * docker exec postgres-container pg_dump -U postgres lmsdb | gzip > /backups/lmsdb_$(date +\%Y\%m\%d).sql.gz
```

---

## Troubleshooting

### Build fails with "out of memory"
- The Docker build (especially Playwright/Chromium install) needs at least 4 GB RAM
- Upgrade to a larger VPS plan or add swap space:
  ```bash
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ```

### SSL certificate not issued
- Verify DNS is pointing to the correct IP: `dig lms.clientcompany.com +short`
- Ensure port 80 and 443 are open on the VPS firewall
- If using Cloudflare, set proxy to **DNS only** (grey cloud), not proxied (orange cloud)
- Check Coolify logs for Let's Encrypt errors

### Database connection refused
- Check that the `db` container is healthy: look at Coolify logs for the `db` service
- Ensure `DB_PASSWORD` env var matches in both the `app` and `db` containers (Coolify handles this via the compose file)

### OTP emails not arriving
- Verify Gmail OAuth credentials in Company Settings > Integrations
- Check the app container logs for `❌ Failed to refresh Gmail OAuth access token`
- Ensure the Gmail account has "Less secure app access" or an App Password
- Check the recipient's spam/junk folder

### App shows "Training Provider" instead of company name
- The admin needs to configure **Company Settings** > Company Name, Short Name, Logo
- Or verify that `COMPANY_NAME` env var was set correctly before first deploy

### Container keeps restarting
- Check logs in Coolify for the specific error
- Common causes: missing `DATABASE_URL`, invalid `DB_PASSWORD`, port conflicts

### Need to start completely fresh
1. In Coolify, stop the resource
2. Delete the `postgres_data` volume (this erases all database data)
3. Redeploy — the init scripts will run again with a blank database

---
---

## Appendix A: Gmail OAuth Setup (Detailed)

Gmail OAuth is **required** for the platform to send emails — OTP verification, course confirmations, certificates, trainer invitations, support ticket notifications, and more. Without this, users cannot log in via OTP.

### Overview

The platform uses the **Gmail API** (not SMTP) to send emails. This requires:
1. A **Google Cloud project** with the Gmail API enabled
2. An **OAuth 2.0 Client ID** and **Client Secret**
3. A **Refresh Token** that grants offline access to the sender's Gmail account

The credentials are entered in the Admin UI and stored in the `training_provider` database table.

---

### A1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the **project dropdown** (top-left, next to "Google Cloud")
3. Click **"New Project"**
4. Enter a project name (e.g., `ClientName LMS`)
5. Click **"Create"**
6. Wait for the project to be created, then select it from the project dropdown

---

### A2. Enable the Gmail API

1. In the Google Cloud Console, go to **APIs & Services > Library**
   - Or navigate to: `https://console.cloud.google.com/apis/library`
2. Search for **"Gmail API"**
3. Click on **Gmail API**
4. Click **"Enable"**
5. Wait for it to be enabled (takes a few seconds)

> **Also enable these APIs** if you plan to use Google Calendar, Drive, or Slides:
> - **Google Calendar API** — for class schedule sync
> - **Google Drive API** — for file storage and certificate uploads
> - **Google Slides API** — for certificate generation from templates

---

### A3. Configure the OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Select **"External"** user type (unless you have a Google Workspace org, then use "Internal")
3. Click **"Create"**
4. Fill in the required fields:
   - **App name:** `ClientName LMS`
   - **User support email:** Select the client's email
   - **Developer contact information:** Enter the client's email
5. Click **"Save and Continue"**
6. On the **Scopes** screen:
   - Click **"Add or remove scopes"**
   - Add these scopes:
     - `https://mail.google.com/` (Gmail — send emails)
     - `https://www.googleapis.com/auth/drive` (Google Drive — file storage)
     - `https://www.googleapis.com/auth/presentations` (Google Slides — certificates)
     - `https://www.googleapis.com/auth/calendar` (Google Calendar — class sync)
   - Click **"Update"**
7. Click **"Save and Continue"**
8. On the **Test users** screen:
   - Click **"Add Users"**
   - Add the Gmail address that will be used as the email sender (e.g., `admin@clientcompany.com`)
   - Click **"Save and Continue"**
9. Click **"Back to Dashboard"**

> **Note:** While the app is in "Testing" mode, only test users can authorise. This is fine — only the sender email needs to authorise. You do NOT need to publish the app to Google for review.

---

### A4. Create OAuth 2.0 Credentials

1. Go to **APIs & Services > Credentials**
2. Click **"+ Create Credentials"** > **"OAuth client ID"**
3. Configure:
   - **Application type:** `Web application`
   - **Name:** `LMS Email Service` (or any descriptive name)
   - **Authorized redirect URIs:** Click **"+ Add URI"** and enter:
     ```
     https://developers.google.com/oauthplayground
     ```
4. Click **"Create"**
5. A dialog appears with your credentials. **Copy and save both:**
   - **Client ID** (looks like: `123456789-abcdefg.apps.googleusercontent.com`)
   - **Client Secret** (looks like: `GOCSPX-abcdefghijklmnop`)
6. Click **"OK"**

---

### A5. Generate a Refresh Token

The Refresh Token is a long-lived credential that allows the platform to send emails on behalf of the sender Gmail account without requiring the user to re-authenticate.

1. Open [Google OAuth Playground](https://developers.google.com/oauthplayground/) in your browser

2. **Configure to use your own credentials:**
   - Click the **gear icon** (top-right corner, "OAuth 2.0 configuration")
   - Check **"Use your own OAuth credentials"**
   - Enter:
     - **OAuth Client ID:** (paste the Client ID from step A4)
     - **OAuth Client Secret:** (paste the Client Secret from step A4)
   - Close the settings panel

3. **Step 1 — Select & authorize APIs:**
   - In the left panel, find **"Gmail API v1"** and expand it
   - Select: `https://mail.google.com/`
   - **(Optional)** Also select these if using Drive/Calendar/Slides:
     - Under **Google Drive API v3**: `https://www.googleapis.com/auth/drive`
     - Under **Google Slides API v1**: `https://www.googleapis.com/auth/presentations`
     - Under **Google Calendar API v3**: `https://www.googleapis.com/auth/calendar`
   - Click **"Authorize APIs"**

4. **Sign in and grant access:**
   - A Google sign-in page appears
   - Sign in with the **sender Gmail account** (the one that will send OTP emails)
   - You may see a warning: "Google hasn't verified this app" — click **"Advanced"** > **"Go to ClientName LMS (unsafe)"**
   - Review the permissions and click **"Allow"**
   - Click **"Allow"** again to confirm

5. **Step 2 — Exchange authorization code for tokens:**
   - You'll be redirected back to OAuth Playground
   - Click **"Exchange authorization code for tokens"**
   - The response will contain:
     ```json
     {
       "access_token": "ya29.a0AfH6SM...",
       "refresh_token": "1//0eXy1a2b3c4d5e6f...",
       "token_type": "Bearer",
       "expires_in": 3599
     }
     ```
   - **Copy the `refresh_token` value** — this is what you need

> **Important:** The refresh token is shown only once. If you lose it, you'll need to repeat steps 3-5.

---

### A6. Enter Credentials in the LMS Admin UI

1. Log in to the LMS as **Admin** or **Training Provider**
2. Navigate to **Training Provider > Company Settings**
3. Scroll down to the **"Integrations"** section (click to expand if collapsed)
4. Fill in the following fields:

   | Field | Value |
   |---|---|
   | **Email User** | The Gmail address that will send emails (e.g., `admin@clientcompany.com`) |
   | **Google Client ID** | Paste the Client ID from step A4 |
   | **Google Client Secret** | Paste the Client Secret from step A4 |
   | **Google Refresh Token** | Paste the Refresh Token from step A5 |

5. Click **"Save"** at the bottom of the Company Settings page

---

### A7. Test the Email Configuration

1. After saving, go to any **Email Template** page (e.g., Training Provider > OTP Email Template)
2. Click **"Send Test Email"**
3. Enter a recipient email address and click **"Send"**
4. Check the recipient's inbox (and spam folder)
5. If the test email arrives, Gmail OAuth is working correctly

**If it fails,** check:
- The app container logs for `❌ Failed to refresh Gmail OAuth access token`
- That the sender Gmail account was added as a **test user** in the OAuth consent screen (step A3.8)
- That all four fields (Email User, Client ID, Client Secret, Refresh Token) are filled in correctly
- That the Refresh Token was generated using the same Client ID and Client Secret

---

### A8. Troubleshooting Gmail OAuth

| Issue | Solution |
|---|---|
| `invalid_grant` error | The refresh token has expired or been revoked. Regenerate it (repeat step A5). This can happen if the user changes their Google password or revokes app access. |
| `access_denied` error | The sender Gmail account is not added as a test user in the OAuth consent screen. Add it (step A3.8). |
| `Token has been expired or revoked` | Same as `invalid_grant` — regenerate the refresh token. |
| Emails go to spam | Add SPF/DKIM records for the sender domain. Consider using a custom domain with Google Workspace instead of a free Gmail account. |
| `insufficient_scope` error | The refresh token was generated without the required Gmail scope. Regenerate it and ensure `https://mail.google.com/` is selected in step A5.3. |

---
---

## Appendix B: SSG TPGateway Certificate Setup (Detailed)

SkillsFuture Singapore (SSG) integration requires **client certificate authentication (mTLS)** to communicate with the TPGateway API. This is used for course publishing, enrollment submission, grant/claim management, and assessment updates.

### Overview

SSG provides training providers with:
- A **PEM certificate file** (`.pem` or `.crt`) — the client certificate
- A **Private key file** (`.pem` or `.key`) — the corresponding private key
- An **Encryption key** (base64 string) — for encrypting API request payloads (AES-256-CBC)

These are issued per "SSG App" (App 1, App 2, App 3, or App 4). Most training providers use **App 1** or **App 3**. App 4 uses OAuth instead of certificates.

The platform supports **multiple SSG apps simultaneously** — you can configure certificates for App 1, App 3, and OAuth for App 4 all at the same time, and select a default.

---

### B1. Obtain SSG Certificates

Before you begin, you need the certificate files from SSG. These are typically provided:
- During the TPGateway onboarding process
- Via the SSG Partner Portal
- Through your SSG account manager

You should receive:
1. **Certificate file** — e.g., `ssg-app1-cert.pem` (PEM format, starts with `-----BEGIN CERTIFICATE-----`)
2. **Private key file** — e.g., `ssg-app1-key.pem` (PEM format, starts with `-----BEGIN RSA PRIVATE KEY-----` or `-----BEGIN PRIVATE KEY-----`)
3. **Encryption key** — a base64-encoded string (e.g., `K7xB2p9...==`)

> **Important:** These certificates have an **expiry date** (usually 1-2 years). The platform tracks expiry dates and displays them in Company Settings. Set a calendar reminder to renew before expiry.

---

### B2. Upload Certificates via the Admin UI

1. Log in to the LMS as **Admin** or **Training Provider**
2. Navigate to **Training Provider > Company Settings**
3. Scroll down to the **"SSG Configuration"** section

#### For App 1 Certificates:

4. Find the **"App 1"** section
5. **Upload the certificate file:**
   - Click the **"Upload Certificate"** button (or the file input next to "App 1 Certificate")
   - Select your `ssg-app1-cert.pem` file
   - Accepted formats: `.pem`, `.crt`
6. **Upload the private key file:**
   - Click the **"Upload Private Key"** button
   - Select your `ssg-app1-key.pem` file
   - Accepted formats: `.pem`, `.key`
7. **Enter the encryption key:**
   - In the **"App 1 Encryption Key"** text field
   - Paste the base64 encryption key string provided by SSG
   - This is a text value, not a file upload

#### For App 3 Certificates (if applicable):

8. Repeat steps 4-7 for the **"App 3"** section with the corresponding App 3 files

#### For App 4 OAuth (if applicable):

9. Find the **"App 4"** section
10. Enter:
    - **App 4 Client ID** — OAuth client ID from SSG
    - **App 4 Client Secret** — OAuth client secret from SSG

> **Note:** App 4 uses OAuth instead of certificates. No PEM file upload is needed.

---

### B3. Select the Default SSG App

1. In the SSG Configuration section, find **"Default SSG App"**
2. Select which app to use by default:
   - **`app1`** — Most common for new integrations
   - **`app3`** — Used by some training providers
   - **`app4`** — OAuth-based (newer approach)
3. Click **"Save"**

The platform will use the selected app's credentials for all SSG API calls by default. Individual API calls can override the app selection via the `x-ssg-app` request header.

---

### B4. How Certificates Are Stored

When you upload certificate files through the UI:

1. Files are saved to the server filesystem:
   ```
   public/uploads/training_provider/
   ├── ssg_app1_cert/          ← App 1 certificate (.pem)
   ├── ssg_app1_private_key/   ← App 1 private key (.pem)
   ├── ssg_app3_cert/          ← App 3 certificate (.pem)
   └── ssg_app3_private_key/   ← App 3 private key (.pem)
   ```

2. The **file paths** are stored in the `training_provider` database table:
   - `ssg_app1_cert_file` — path to App 1 cert
   - `ssg_app1_private_key_file` — path to App 1 key
   - `ssg_app1_encryption_key` — App 1 encryption key (text, not file)
   - `ssg_app3_cert_file` — path to App 3 cert
   - `ssg_app3_private_key_file` — path to App 3 key
   - `ssg_app3_encryption_key` — App 3 encryption key (text)
   - `ssg_app4_client_id` — App 4 OAuth client ID
   - `ssg_app4_client_secret` — App 4 OAuth client secret
   - `ssg_default_app` — which app to use by default

3. Files persist across redeploys via the **`uploads_data`** Docker volume

---

### B5. Alternative: Environment Variables

If you prefer to configure SSG certificates via environment variables instead of the UI (e.g., for CI/CD or Docker secrets), set these:

| Variable | Value |
|---|---|
| `CERT_1_NAME` | `App1` (label) |
| `CERT_1_CERT` | Base64-encoded certificate content, or literal PEM string |
| `CERT_1_KEY` | Base64-encoded private key content, or literal PEM string |
| `CERT_1_ENCRYPTION_KEY` | Encryption key (base64 string) |
| `CERT_2_NAME` | `App2` (label) |
| `CERT_2_CERT` | Base64-encoded certificate content |
| `CERT_2_KEY` | Base64-encoded private key content |
| `CERT_2_ENCRYPTION_KEY` | Encryption key |
| `CERT_3_NAME` | `App3` (label) |
| `CERT_3_CERT` | Base64-encoded certificate content |
| `CERT_3_KEY` | Base64-encoded private key content |
| `CERT_3_ENCRYPTION_KEY` | Encryption key |

The credentials service checks both the database and environment variables, with the database taking priority.

---

### B6. How SSG Authentication Works

When the platform makes an API call to SSG (e.g., submitting an enrollment):

```
1. Load credentials from training_provider table
   └── Select the correct app (app1/app3/app4 based on ssg_default_app)

2. For App 1/App 3 (certificate-based):
   ├── Read the certificate PEM file from disk
   ├── Read the private key PEM file from disk
   ├── Decode the encryption key from base64
   ├── Create AES-256-CBC cipher with encryption key + fixed IV
   ├── Encrypt the API request payload
   ├── Attach certificate + private key to HTTPS request (mTLS)
   └── Send request to SSG API endpoint

3. For App 4 (OAuth-based):
   ├── Use client_id + client_secret to get access token
   ├── Encrypt the API request payload (same AES-256-CBC)
   ├── Attach access token as Bearer header
   └── Send request to SSG API endpoint
```

---

### B7. Verify SSG Integration

After uploading certificates:

1. Go to **Admin > Class Management**
2. Select a course run that needs to be published to SSG
3. Try a **TPGateway action** (e.g., "Publish to SSG" or "Submit Enrollment")
4. Check the response:
   - **Success:** The operation completes and the SSG status updates
   - **Certificate error:** `SSL_ERROR`, `CERTIFICATE_REQUIRED`, or `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — check that the cert and key files are correct and not expired
   - **Encryption error:** `Decryption failed` or `Bad decrypt` — check the encryption key is correct

---

### B8. Certificate Renewal

SSG certificates expire (typically every 1-2 years). To renew:

1. Obtain new certificate files from SSG
2. Go to **Training Provider > Company Settings > SSG Configuration**
3. Upload the new certificate and private key files (they replace the old ones)
4. Update the encryption key if it changed
5. Click **"Save"**
6. Test an SSG API call to verify the new certificates work

The platform displays **certificate expiry dates** in the SSG Configuration section. Monitor these and renew before they expire to avoid service interruptions.
