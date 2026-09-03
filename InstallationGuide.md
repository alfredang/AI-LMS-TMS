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
19. [Appendix C: Local Development Setup for a New Client (Claude Code / VS Code)](#appendix-c-local-development-setup-for-a-new-client-claude-code--vs-code)
20. [Appendix D: Connecting Local Dev to a Client's Coolify Database (Worked Example: Chariot)](#appendix-d-connecting-local-dev-to-a-clients-coolify-database-worked-example-chariot)
21. [Appendix E: Adding Another Client Clone Alongside Existing Ones (Worked Example: Intellisoft)](#appendix-e-adding-another-client-clone-alongside-existing-ones-worked-example-intellisoft)

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

> **A note on placeholders in this guide.** Any IP address you see (`203.0.113.10`, `203.0.113.20`), domain (`clientcompany.com`), email (`admin@clientcompany.com`, `clientname.lms@gmail.com`), or UEN (`202412345X`) is a **placeholder** drawn from the IANA documentation ranges. None refers to a real server, customer, or account. Replace with the actual values when running these steps for a real client. Never commit real IPs, credentials, or client identifiers to this document.

1. Log in to [Hostinger](https://www.hostinger.com/) and go to **VPS** section
2. Purchase or provision a new VPS:
   - **OS:** Ubuntu 22.04 or 24.04 LTS
   - **Plan:** KVM 2 or higher (4 GB RAM minimum)
   - **Location:** Choose the region closest to the client's users
3. Once provisioned, note down:
   - **Server IP Address** (e.g., `203.0.113.10`)
   - **Root Password** (or set up SSH keys)
4. **SSH into the server** to verify access:
   ```bash
   ssh root@203.0.113.10
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
   ssh root@203.0.113.10
   ```

2. **Run the Coolify installer** (one command):
   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
   ```
   This installs Docker, Docker Compose, and Coolify. It takes 2-5 minutes.

3. **Wait for the installation to complete.** You'll see a message like:
   ```
   Coolify installed successfully!
   Please visit http://203.0.113.10:8000 to get started.
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
   - **Value / Points to:** `203.0.113.10` (the Hostinger VPS IP)
   - **TTL:** `300` (5 minutes, or Auto)
3. If using a root domain, also add a **www** record:
   - **Type:** `CNAME`
   - **Host / Name:** `www`
   - **Value / Points to:** `clientcompany.com`

#### Worked example — GoDaddy → Hostinger Coolify (IP `203.0.113.20`)

Use this when the client's domain is registered at GoDaddy and the LMS/TMS Coolify instance is running on the Hostinger VPS at `203.0.113.20`. The example assumes you want the LMS at `lms.clientcompany.com`.

1. **Log in to GoDaddy** at <https://sso.godaddy.com/> with the account that owns the domain.
2. Open the **Products** page → find the domain (`clientcompany.com`) → click **DNS** (or **Manage DNS**). The **DNS Management** page opens, listing the existing records (NS, SOA, default A/CNAME entries, etc.).
3. In the **Records** table, click **Add New Record**. Fill in:

   | Field | Value |
   |---|---|
   | **Type** | `A` |
   | **Name** | `lms` &nbsp;(just the subdomain — GoDaddy appends the apex automatically) |
   | **Value** | `203.0.113.20` |
   | **TTL** | `600 seconds` (or `1 Hour`) — pick the lowest GoDaddy lets you use while testing |

   Click **Save**.

4. **(Only if pointing the apex `clientcompany.com` instead of a subdomain)** edit the existing root `A` record (Name `@`) and change its **Value** to `203.0.113.20`. Then add a CNAME so `www` follows the apex:

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
   # 203.0.113.20
   ```

   If you see anything else (e.g., a parked-domain IP), wait a few more minutes and retry — GoDaddy occasionally takes longer for first-time records.

6. Once `dig` returns `203.0.113.20`, continue to [Step 7](#step-7-configure-the-domain-in-coolify) and set the domain in Coolify so Let's Encrypt can issue the SSL certificate.

> **Tip:** GoDaddy's UI sometimes shows two A records for the same name during propagation — the old one and the one you just added. Delete the stale entry once the new one is live so the resolver doesn't round-robin between them.

### Option B: Client uses Cloudflare

1. Log in to Cloudflare > select the domain
2. Go to **DNS** > **Records**
3. Click **Add Record:**
   - **Type:** `A`
   - **Name:** `lms` (or `@` for root domain)
   - **IPv4 Address:** `203.0.113.10`
   - **Proxy status:** Toggle **OFF** (DNS only / grey cloud) — Let Coolify handle SSL, not Cloudflare
   - **TTL:** Auto
4. Click **Save**

### Verify DNS Propagation

Wait 2-10 minutes, then verify the DNS is working:

```bash
# From your local terminal
nslookup lms.clientcompany.com
# Should return the VPS IP: 203.0.113.10

# Or use dig
dig lms.clientcompany.com +short
# Should return: 203.0.113.10
```

> **Important:** DNS propagation can take up to 48 hours in rare cases, but usually completes within 5-15 minutes. Do not proceed to Coolify domain configuration until DNS is resolving correctly, otherwise SSL certificate generation will fail.

---

## Step 5: Create a Docker Compose Resource in Coolify

This is the step most installations get tripped up on, because Coolify's resource picker presents many options that *look* like they'd work but won't run a `docker-compose.yml`. The two correct paths are documented below, with the GitHub App path strongly preferred.

> **Common mistake.** Picking **"Public Repository"** or **"Private Repository"** without changing the **Build Pack** results in Coolify defaulting to **Nixpacks**, which tries to auto-detect the framework and ignores `docker-compose.yml`. The deploy "succeeds" but only the Next.js app starts (no Postgres), and the app immediately fails health checks because it can't reach the DB. The fix is to **change Build Pack to Docker Compose** at the resource-creation screen — see Step 5.4 below.

### 5.1 Create the Project shell

1. **Open Coolify** at `http://<server-ip>:8000`
2. Click **"Projects"** in the left sidebar
3. Click **"+ Add"**
4. **Name** the project after the client (e.g., `Intellisoft LMS`, `Chariot Learning LMS`)
5. Click **"Save"**
6. Click into the new project. You'll see a default **Production** environment — use that, or click **"+ New Environment"** if the client needs separate staging/prod.

### 5.2 Choose how Coolify will connect to GitHub

Coolify needs *some* way to pull the LMS/TMS repo. There are three options, in decreasing order of preference:

| Connection method | When to use | Setup location |
|---|---|---|
| **(A) GitHub App** | **Recommended.** Most secure (fine-grained permissions, only the repos you select), supports automatic webhook-triggered deploys, no PAT to expire | Coolify left sidebar → **Sources** → **+ New** → GitHub App |
| **(B) Personal Access Token (PAT)** | Quick fallback if you can't create a GitHub App right now (org policy, etc.) | Same Sources page, "Public Repository" + PAT for `repo` scope |
| **(C) Deploy Key** | Last resort, single-repo only | Sources → Deploy Key → paste public key into the GitHub repo's Deploy Keys |

If a GitHub App already exists in this Coolify instance from a prior client, you can reuse it — just make sure it's installed on the LMS/TMS repo (GitHub UI → app settings → Install Repositories).

### 5.3 Set up the GitHub App (first-time only — skip if reusing)

1. In Coolify, left sidebar → **Sources** → **+ New** → **GitHub App**.
2. You'll see two installation paths:
   - **Automated Installation** (recommended) — one-click manifest registration
   - **Manual Installation / Continue** — paste an existing App ID + private key. Use only if you've already created a GitHub App outside Coolify.
3. Click **"Register Now"** under Automated Installation.
4. Coolify redirects you to GitHub. GitHub shows a **pre-filled app manifest** with name, permissions, and webhook URL. The webhook URL will look like `http://<your-coolify-vps-ip>:8000/...` — plain HTTP, IP-based. **This is fine for now**; we'll address it under "Webhook URL caveat" below.
5. Click **"Create GitHub App"**. GitHub may prompt for your password.
6. After creation, GitHub immediately redirects to the **app install page**:
   - Select **"Only select repositories"** (safer than "All repositories")
   - Pick the LMS/TMS repo (e.g., `alfredang/AI-LMS-TMS`)
   - Click **"Install"**
7. GitHub redirects back to Coolify. The Source now shows as connected, with no red warnings.

> **If you see a "You must complete this step" warning in Coolify** with a big **"Install Repositories on GitHub"** button: that means the app exists but isn't installed on any repo yet. Click the button, follow the same flow as step 6 above, and the warning will disappear.

> **Webhook URL caveat.** The GitHub App's webhook URL is registered as `http://<coolify-ip>:8000/...`. GitHub allows plain HTTP webhooks today, but they're discouraged and noisier in delivery logs. If/when you put Coolify's own UI behind a domain with SSL (separate from the LMS domain in Step 7 — Coolify's UI typically stays on `:8000` unless you reverse-proxy it), come back and update this source's webhook URL to the HTTPS one. Not blocking.

### 5.4 Create the Docker Compose resource

Now you have a Project, an Environment, and a Source. Create the actual deployable:

1. Navigate: **Projects (sidebar) → click into your project → click into the Production environment**.
2. Click **"+ New Resource"**.
3. The resource picker appears. **Pick the right entry — this is where most setups go wrong.** Look under the **Git Based** section:

   | Picker entry | Use when |
   |---|---|
   | **Private Repository (with GitHub App)** | ✅ **Recommended.** Use the source you set up in 5.3. |
   | **Private Repository (with Deploy Key)** | Only if you went with method (C). |
   | **Public Repository** | If the LMS/TMS repo is public AND you accepted method (B). |
   | **Docker Compose Empty** | Don't use for this guide — that's for hand-pasting a compose file, not deploying from Git. |
   | **Dockerfile** / **Application** | Don't use — these bypass `docker-compose.yml` entirely (the Step 5 intro warning). |

4. After picking the entry, fill in the form on the next screen. **Every field below matters; don't skip any:**

   | Field | Value | Notes |
   |---|---|---|
   | **GitHub Source** (only on the App path) | The source you created in 5.3 | If empty, your app isn't installed on any repo yet — go back to 5.3 step 7 |
   | **Repository** | `alfredang/AI-LMS-TMS` (or wherever the LMS/TMS code lives) | Full `owner/repo` |
   | **Branch** | `main` | Coolify will deploy on every push to this branch via the GitHub App webhook |
   | **Build Pack** | **`Docker Compose`** | ⚠️ **Critical — defaults to Nixpacks.** Change it to Docker Compose, or `docker-compose.yml` will be ignored and the deploy will fail in confusing ways |
   | **Docker Compose Location** | `docker-compose.yml` | Appears only after Build Pack = Docker Compose. Path is relative to the repo root, default is correct |
   | **Base Directory** | `/` | Leave default unless the compose file is in a subdirectory |
   | **Is it a static site?** | No | |
   | **Preserve Repository During Deployment** | ✅ **Check it.** | ⚠️ **Off by default and easy to miss.** When unchecked, Coolify wipes the cloned repo between deploys — which deletes the `database/*.sql` init scripts that Docker Compose bind-mounts into the Postgres container. The first deploy may work; subsequent deploys leave Postgres with no init scripts and the app crashes with auth/DB errors. Always on for this stack. |

5. Click **"Save"**. **Do NOT click Deploy yet** — we still need to set environment variables (Step 6). Deploying without env vars will spin up containers that immediately crash on missing `DB_PASSWORD`, `JWT_SECRET`, etc.

> **If you've already created the resource without "Preserve Repository" checked,** you don't need to recreate it. Open the resource → **Configuration** → **General** tab → scroll to the **Build** section → tick **"Preserve Repository During Deployment"** → **Save**. The setting takes effect on the next deploy.

### 5.5 Verify the resource was created correctly

After Save, you land on the resource's overview page. Confirm:

- The page header shows the resource name and **"Docker Compose"** as the build pack (not Nixpacks/Dockerfile).
- The **Services** panel (or sidebar) lists two services: **`app`** and **`db`**, parsed from `docker-compose.yml`.
- The **General** / **Configuration** tab shows the GitHub Source, repo, branch (`main`), and compose file path.

If you see only one service, or no services at all, the build pack didn't actually take Docker Compose — go back to step 5.4 and re-check the Build Pack dropdown. (Sometimes Coolify caches the old setting; deleting and recreating the resource is faster than fighting the form.)

### 5.6 Common troubleshooting at this step

| Symptom | Cause | Fix |
|---|---|---|
| Picker shows no "Private Repository (with GitHub App)" entry | No GitHub App source exists yet | Do 5.3 first |
| GitHub App source exists but resource creation says "no repos available" | App isn't installed on any repo, or you didn't grant access to this specific repo | GitHub → app settings → Install Repositories → add the LMS/TMS repo |
| Build Pack dropdown doesn't show "Docker Compose" | You're on a screen that doesn't support compose (e.g., Dockerfile-only path) | Cancel, go back to "+ New Resource", pick a Git-based entry |
| After Save, no `db` service appears | Build Pack is still Nixpacks / Dockerfile, ignoring `docker-compose.yml` | Edit the resource's Configuration → change Build Pack → re-save. If that doesn't work, recreate the resource. |
| Webhook isn't firing on `git push` | App webhook URL is HTTP and GitHub silently dropped it (rare), or the app isn't installed on this specific repo | GitHub → app settings → Recent Deliveries — check for failures. Reinstall the app on the repo if missing. |
| First deploy worked, second deploy fails with Postgres init errors / "role postgres does not exist" / app can't auth to DB | "Preserve Repository During Deployment" is unchecked, so Coolify wiped the repo dir between deploys and the `database/*.sql` init scripts that the compose file bind-mounts into Postgres are gone | Resource → Configuration → General → Build → tick **"Preserve Repository During Deployment"** → Save. Next deploy will work. (For a fresh start: delete the `postgres_data` volume so init scripts re-run, then redeploy.) |

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
| `DIRECT_APPLICATION_EMAIL_INGEST_TOKEN` | `<generate-random-64-char-string>` | Shared bearer token for the MySkillsFuture Direct Application email-ingest endpoint. Must match the Google Apps Script `TMS_BEARER_TOKEN` if that automation is enabled. |

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

**Gmail OAuth is the only fully-supported email transport.** The system uses the Gmail API (not SMTP) for everything user-facing: OTP login, certificate delivery, trainer invitations, course confirmations, completion emails. Without Gmail OAuth, users cannot log in.

Email is configured **after first login** via the Admin UI (Training Provider > Company Settings > Integrations). You enter:
- Gmail OAuth Client ID
- Gmail OAuth Client Secret
- Gmail OAuth Refresh Token
- Sender email address

**No env vars needed** — credentials are stored in the `training_provider` table. Detailed walkthrough in [Appendix A](#appendix-a-gmail-oauth-setup-detailed).

> **A note on SMTP env vars.** The codebase exposes `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`, but they are **only consumed by the support-ticket notification path** (`lib/services/emailService.ts`, used by `pages/api/tickets/create.ts`). They do **not** drive OTP login, certificates, trainer invitations, or any other user-facing email. Setting these as a "fallback" for Gmail OAuth will not work — OTP login will still fail until the four `training_provider` Gmail columns are filled in.

> **What if a client cannot use Gmail OAuth?** Three practical options:
>
> 1. **Recommended — use a Google Workspace service mailbox.** The Gmail account does not need to be a real human's inbox. Create a dedicated mailbox like `noreply@clientcompany.com` in the client's Google Workspace and OAuth that. This satisfies most "we don't want personal Gmail" objections at zero engineering cost.
> 2. **Use a free Gmail account** (`clientname.lms@gmail.com`) for OTP only. Works the same as Workspace OAuth, but emails go out from a `@gmail.com` address — usable for testing or low-touch deployments, not ideal for client-branded production.
> 3. **Add a different transport (Resend, SES, generic SMTP) — code change required.** None of these are wired up today. Adding one means a new `email_provider` column on `training_provider`, a small adapter layer, and updates to the ~10 places that currently call the Gmail API directly. Roughly half a day's work for Resend (simplest API), 1–2 days for a clean multi-provider abstraction. Do this only if the client genuinely can't use any Google account.

> **Why Gmail API and not SMTP?** SMTP via Gmail (port 587, App Password) is rate-limited to ~500/day and frequently throttled. The Gmail API gives much higher quotas, better deliverability, and reliable refresh-token auth. The architecture decision predates the Resend era and was the right call at the time — but it does mean every new client needs a Google account.

### 6.3 Required for AI Features

| Variable | Value | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | For the CP Generator and Courseware Generator |
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
| `OPENCLAW_GATEWAY_URL` | OpenClaw agent gateway (AI chatbot backend) |
| `OPENCLAW_GATEWAY_TOKEN` | OpenClaw gateway authentication |

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

### 10.0 Post-Deployment Configuration Checklist

Use this as a single-page reference for what needs to be configured before handing the system to the client. Items are ordered by **deployment criticality** — anything marked **Required** must be done before users can meaningfully use the system; **Recommended** unlocks core features; **Optional** is per-client.

| # | Item | Priority | Where to configure | Why it matters | Detail |
|---|---|---|---|---|---|
| 1 | Change admin default password | **Required** | Login screen (forced on first login) | Default password is in env vars and visible to anyone with VPS access | [9](#step-9-first-boot--what-happens-automatically) |
| 2 | Company name, short name, logo | **Required** | Company Settings → Branding | Appears on login screen, emails, certificates, invoices — the visible identity of the system | [10.1](#101-branding--identity) |
| 3 | Company address, phone, support email | **Required** | Company Settings → Branding | Help page, email footers, support links, calendar event organiser | [10.1](#101-branding--identity) |
| 4 | Privacy Policy & Acceptable Use Policy | **Required** | Company Settings → Branding | Legal text shown on login modal — must reflect the client, not Tertiary | [10.1](#101-branding--identity) |
| 5 | **Gmail OAuth** (Client ID, Client Secret, Refresh Token, sender email) | **Required** | Company Settings → Integrations | Without this, OTP login emails do not send and users cannot log in. **Most critical post-deploy step.** | [10.2](#102-email-configuration-critical), [Appendix A](#appendix-a-gmail-oauth-setup-detailed) |
| 6 | OTP & Certificate email templates | **Required** | Email Templates pages | Subject + body for OTP, certificate delivery, course confirmation, etc. | [10.2](#102-email-configuration-critical) |
| 7 | Default password & "Force first password change" | **Required** | Company Settings → Feature Toggles | Default password assigned to new accounts; enforce change-on-first-login | [10.5](#105-feature-toggles) |
| 8 | Color scheme | **Recommended** | Company Settings → Branding | UI theme — match client's brand colours | [10.1](#101-branding--identity) |
| 9 | Anthropic API key (for the CP Generator and Courseware Generator) | **Recommended** | Training Provider → API Keys (`training_provider_api`, `key_name = 'ANTHROPIC_API_KEY'`) | Without this, the content generators won't work. Use a `sk-ant-oat*` token (subscription) or `sk-ant-api*` (PAYG) | [Step 6.3](#63-required-for-ai-features) |
| 10 | Google Gemini API key | **Recommended** | API Keys + env var `NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY` | Powers the public-facing chatbot on marketing pages | [Step 6.3](#63-required-for-ai-features) |
| 11 | Firecrawl API key | **Recommended** | API Keys (`key_name = 'FIRECRAWL_API_KEY'`) — also editable under TP profile → Credentials → Firecrawl | Trainer-profile enrichment from LinkedIn / personal sites | [CLAUDE.md → Web Scraping](CLAUDE.md) |
| 12 | Google Calendar ID + sync toggle | **Recommended** | Company Settings → Google Integration | Class schedules push to a shared calendar — trainers see all upcoming classes | [10.3](#103-google--zoom-integrations-optional) |
| 13 | Google Drive folder URLs (certificates, uploads) | **Recommended** | Company Settings → Google Integration | Certificate PDFs and file uploads stored in client's Drive | [10.3](#103-google--zoom-integrations-optional) |
| 14 | Google Slides certificate template ID | **Recommended** | Company Settings → Google Integration | Auto-generated certificates render from this template | [10.3](#103-google--zoom-integrations-optional) |
| 14a | Zoom virtual meetings | **Optional** | Company Settings → Integrations | Lets admins generate Zoom meeting links for course runs using the training provider's connected Zoom account | [10.3](#103-google--zoom-integrations-optional) |
| 15 | GST registration & rate | **Recommended** (SG clients) | Company Settings → Financial | Tax line items on invoices, proforma invoices, receipts | [10.4](#104-financial-settings) |
| 16 | Funding rates (Normal / Enhanced) | **Recommended** (SG clients) | Company Settings → Financial | SkillsFuture funding calculations on enrollment fees | [10.4](#104-financial-settings) |
| 17 | **SSG TPGateway certificates** (App 1 / App 3 cert + private key + encryption key) | **Required for SG SSG clients** | Company Settings → SSG Configuration | mTLS auth for course publishing, enrollment submission, grant claims | [10.6](#106-ssgtpgateway-singapore-training-providers-only), [Appendix B](#appendix-b-ssg-tpgateway-certificate-setup-detailed) |
| 18 | SSG App 4 OAuth (Client ID + Secret) | **Optional** (SG clients using App 4) | Company Settings → SSG Configuration | OAuth-based SSG integration for newer endpoints | [Appendix B](#appendix-b-ssg-tpgateway-certificate-setup-detailed) |
| 19 | Default SSG App selector | **Required for SG SSG clients** | Company Settings → SSG Configuration | Picks which app (`app1`/`app3`/`app4`) is used by default for SSG calls | [10.6](#106-ssgtpgateway-singapore-training-providers-only) |
| 20 | QuickBooks OAuth (Client ID, Secret, Realm ID, Refresh Token) | **Optional** | Env vars or Admin UI | Enables invoice / customer / payment sync to QuickBooks Online | [Step 6.4](#64-optional-enable-as-needed-later) |
| 21 | Auto-send toggles (proforma invoices, confirmation emails, certificates) | **Recommended** | Company Settings → Feature Toggles | Controls which scheduled jobs actually fire — leave OFF until you've verified credentials work | [10.5](#105-feature-toggles) |
| 22 | OTP login enable + Default OTP toggle | **Required** | Company Settings → Feature Toggles | Enable OTP login; **disable Default OTP** in production (it's a fixed-code testing aid) | [10.5](#105-feature-toggles) |
| 23 | Leaderboard / Point System | **Optional** | Company Settings → Feature Toggles | Gamification — turn on if the client wants learner engagement features | [10.5](#105-feature-toggles) |
| 24 | Scheduler tasks review | **Recommended** | Admin → Scheduler | Roughly 17 cron jobs (certificate generation, SSG sync, calendar sync, etc.). Disable any not relevant to this client to avoid noisy errors in logs | [CLAUDE.md → Scheduler](CLAUDE.md) |
| 25 | Create initial user accounts (trainers, finance, training-provider users) | **Recommended** | Admin → User Management | Onboard the client's actual staff before handing over | — |

> **Order matters.** Items 1–7 unblock day-1 use. 5 (Gmail OAuth) gates everything else — without it nothing else can be tested end-to-end because OTP emails don't arrive. 17–19 only apply to Singapore training providers using SkillsFuture; non-SG clients can skip the entire SSG block.

> **Per-client variation.** Items 11 (Firecrawl), 17–19 (SSG), 20 (QuickBooks), and 23 (Leaderboard) are commercial integrations that depend on the client's contract. Confirm scope before configuring — and confirm the credentials belong to the **client's** accounts, not Tertiary's.

The detailed sections below cover each grouping in depth.

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

### 10.3 Google & Zoom Integrations (Optional)

| Setting | Purpose |
|---|---|
| Google Calendar ID | Sync class schedules to Google Calendar |
| Google Drive Folder URLs | Certificate storage, file uploads |
| Google Slides Template ID | Template for auto-generated certificates |
| Sync Google Calendar toggle | Enable/disable calendar sync |

**Virtual Meeting provider:** In **Company Settings > Integrations**, choose the default provider (`Google Meet`, `Zoom`, or `Microsoft Teams`). Selecting Google Meet opens the Google panel; selecting Zoom opens the Zoom panel.

This company-level provider is a default, not a bulk migration switch. A course run with its own saved `virtual_meeting_provider` and `virtual_meeting_link` keeps using that saved meeting first; learner and trainer views fall back to the company default only when the course run does not have its own provider/link. Changing the company default from Google Meet to Zoom will not automatically convert, delete, or hide existing Google Meet links. Saving or generating a new meeting link on a course run replaces the single active link for that course run and stores the provider for that link.

**Zoom setup:** Create one Zoom OAuth app in the Zoom App Marketplace for this app/deployment or training provider, then enter its **Zoom OAuth App Client ID** and **Zoom OAuth App Client Secret** in Company Settings. These are app credentials, not a user's Zoom username/password. For most client deployments, a **client-owned private/development OAuth app** is enough if the LMS only needs to connect that client's own Zoom account and is not being publicly distributed through the Zoom Marketplace. If the client already has a suitable production Zoom OAuth app, they can reuse that app's Client ID and Client Secret instead. A full production Marketplace listing is only needed when the integration must be published/distributed to external Zoom customers. In the Zoom app's **Basic Information** section, add this OAuth redirect URL: `https://your-domain.com/api/integrations/zoom/oauth/callback`. Add the granular scopes `user:read:user` and `meeting:write:meeting` to the Zoom app. After saving, click **Connect Zoom** and sign in as the Zoom account that should create/host course-run meetings. The app stores the returned Zoom OAuth tokens at the training-provider level.

For existing deployments, apply `database/migrations/add_zoom_meeting_integration.sql` before using Zoom meeting generation. Fresh databases created from `database/01-schema.sql` already include the required columns.

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
- [ ] AI features work (content generators respond, if `ANTHROPIC_API_KEY` is set)
- [ ] AI chatbot launcher appears and opens the external agent chat (needs the WhatsApp/Telegram Chat Link under Company Settings → Integrations → AI Agent)

### Optional Integrations
- [ ] Google Calendar sync works (if configured)
- [ ] Zoom connects and `Test` succeeds (if Zoom meeting generation is configured)
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
ADMIN_PASSWORD=<replace-with-strong-temp-password>
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

### Pre-flight: choose the sender mailbox

Before the steps below, decide which Gmail/Google Workspace mailbox will actually send the platform's email. There are three viable patterns — pick the one that matches the client's setup:

| Pattern | When to use | Setup step |
|---|---|---|
| **(i) Client already has Google Workspace** at their domain (e.g. `support@clientcompany.com` is on Workspace) | Confirm with `dig MX <domain> +short` — if you see `aspmx.l.google.com`, it's Workspace | Skip ahead to A1 and OAuth that mailbox directly. Best deliverability. |
| **(ii) Client has Workspace but wants a separate sender** | Most common for production — keeps "noreply" out of a real person's inbox | Create `noreply@clientcompany.com` as a Workspace mailbox or alias, OAuth that. Then proceed to A1. |
| **(iii) Client has no Google Workspace** (mailbox is on Microsoft 365 / cPanel / Zoho / Cloudflare routing, or they refuse Workspace) | Cost-sensitive deployments; clients who don't want to add a Workspace seat | Use **A0 — Free Gmail + "Send mail as" alias** below before A1. Works, with a deliverability caveat. |

If the client falls into (iii), do A0 first. Otherwise skip A0 and start at A1.

---

### A0. Free Gmail + "Send mail as" alias (only for clients without Google Workspace)

This pattern lets the platform send email **as** `support@clientcompany.com` (the client's existing address, hosted anywhere) by routing through a free Gmail account that we OAuth.

**How it works conceptually:**

```
LMS  ─── Gmail API (OAuth) ───►  clientname.lms@gmail.com  ─── sends as ───►  support@clientcompany.com
                                  (free Gmail we control)                  (client's real address)
```

The recipient sees the email From `support@clientcompany.com`. Replies go to `support@clientcompany.com` (which still hits the client's existing mailbox, on whatever provider hosts it).

#### A0.1 Create the free Gmail account

1. Go to <https://accounts.google.com/signup>
2. Pick an address that identifies the platform, not a person. Convention: `<client>.lms@gmail.com`. Examples:
   - `clientname.lms@gmail.com`
   - `clientcompanylearning.lms@gmail.com`
3. Use the client's company contact info on signup (recovery phone/email should be reachable by the client, not by us).
4. Save the credentials in the client's password manager — they own this account, not us.

> **Why a dedicated Gmail and not a personal one?** This account holds an OAuth refresh token that can send email on the platform's behalf indefinitely. Tying it to a real person creates a single point of failure when they leave or change their password.

#### A0.2 Add `support@clientcompany.com` as a "Send mail as" alias

1. Sign into `clientname.lms@gmail.com` at <https://mail.google.com/>
2. Click the **gear icon** (top-right) → **See all settings**
3. Open the **Accounts and Import** tab
4. Find the **"Send mail as:"** row → click **Add another email address**
5. In the popup:
   - **Name:** `Chariot Learning Support` (whatever should appear next to the email in recipients' inboxes)
   - **Email address:** `support@clientcompany.com`
   - Leave **"Treat as an alias"** checked
   - Click **Next Step**
6. On the next screen, Gmail offers two ways to send:
   - **Option A — Send through Gmail (default, easier):** leave the default. Emails go through Google's outbound infra; SPF must list `_spf.google.com` (see A0.4).
   - **Option B — Send through your client's SMTP:** if the client wants outbound to literally route via their mail provider's servers, fill in their SMTP host/port/user/pass. Rare; only do this if the client insists.
   - Click **Next Step**
7. Click **Send Verification**
8. Gmail sends a verification email **to `support@clientcompany.com`** with a confirmation link.
9. The **client** opens that mailbox (in whatever provider they use — Microsoft 365, Zoho, cPanel webmail, etc.) and clicks the link, OR forwards you the confirmation code to enter back in Gmail. Either works.

#### A0.3 Make `support@clientcompany.com` the default From

1. Back in **Settings → Accounts and Import → Send mail as**
2. Next to `support@clientcompany.com`, click **make default**
3. Set **"When replying to a message:"** to **"Reply from the same address the message was sent to"**

Result: every email the platform sends through `clientname.lms@gmail.com` will go out with `support@clientcompany.com` as the From address.

#### A0.4 Add SPF (and ideally DKIM) on `clientcompany.com` so emails don't go to spam

This is the **deliverability caveat**. Without it, Outlook/Office 365 will often show "via gmail.com" or drop emails to spam.

**SPF (required, free, fixes most cases):**

The client adds a TXT record on `clientcompany.com`:

```
clientcompany.com    TXT    "v=spf1 include:_spf.google.com include:<their-existing-mail-provider> ~all"
```

`include:_spf.google.com` authorises Google's outbound IPs to send email claiming to be from `clientcompany.com`. Keep any existing `include:` entry (e.g. `include:spf.protection.outlook.com` if they use Microsoft 365) so the client's normal email sending still passes SPF.

Verify after a few minutes:
```bash
dig TXT clientcompany.com +short
```

**DKIM (strongly recommended, but only available on paid Workspace):**

DKIM cryptographically signs outgoing mail with the domain's key, which is what major providers actually trust. Free Gmail accounts **cannot** set up DKIM for arbitrary domains — only Google Workspace can. This is the main reason any client with non-trivial email volume eventually ends up on Workspace.

If the client refuses Workspace, the platform will work, but expect 5–15% of emails (especially to Outlook recipients) to go to spam. Document this expectation up front.

#### A0.5 Now proceed to A1 with the free Gmail

When you reach A3 (OAuth consent screen) and A5 (refresh token), use the free Gmail account (`clientname.lms@gmail.com`), **not** the alias. The OAuth grant is on the actual mailbox, not the address we send mail as.

When you reach A6 (enter credentials in Admin UI), set:

- **Email User:** `support@clientcompany.com` *(the alias — this is what the platform tells Gmail to send From)*
- **Google Client ID / Secret / Refresh Token:** from the free Gmail account's OAuth setup

Gmail accepts an alias as the `From:` header on `users.messages.send` calls **only if it's been verified as a "Send mail as" alias** (which we did in A0.2). That's why A0.2 is non-optional.

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

---

## Appendix C: Local Development Setup for a New Client (Claude Code / VS Code)

Steps 1–11 cover deploying the client's *production* instance to Coolify. This appendix covers the **developer workstation** side: how to clone the repo locally so you can run the dev server, use Claude Code, and connect to that client's database — without touching any other client's environment.

> **Why a separate working directory per client?** The codebase reads `DATABASE_URL` (and every other secret) from `.env.local` in the project root. If you swap `.env.local` files inside one folder, a single mistyped command can write Client A's data into Client B's DB. Putting each client in its own directory makes that mistake structurally impossible. As a bonus, Claude Code keys its memory off the absolute path, so each client gets a fresh memory namespace with no cross-client bleed.

### C1. Clone the repo into a client-specific folder

You can name the folder anything — directory name is not referenced by the code, `package.json`, or any config:

```bash
# Pick a structure like ~/projects/clients/<clientname>/
git clone https://github.com/alfredang/AI-LMS-TMS.git ~/projects/clients/chariot
cd ~/projects/clients/chariot
```

> **Alternative — git worktree.** If you want both clients to share the same `.git` folder (faster `git pull`, less disk), use a worktree instead of a clone:
>
> ```bash
> cd ~/projects/tertiary/ai-lms-tms
> git worktree add ~/projects/clients/chariot main
> ```

### C2. Create the client's `.env.local`

`.env.local` is gitignored — every working directory needs its own. **Never copy a production `DATABASE_URL` into a dev workspace.** Point it at the client's *dev or staging* database (or a local Postgres for early development).

```bash
# Start from the original as a template if useful
cp ~/projects/tertiary/ai-lms-tms/.env.local .env.local

# Then edit at minimum:
#   DATABASE_URL=postgres://...    ← new client's DB (never the original)
#   JWT_SECRET=...                 ← regenerate, do not reuse
#   GOOGLE_CLIENT_ID / SECRET      ← new client's Google OAuth app
#   ANTHROPIC_API_KEY / OPENAI...  ← new client's keys
#   SSG / TPGateway certs          ← new client's, if applicable
#   QUICKBOOKS_*                   ← new client's
```

**Crossing client secrets is worse than crossing DBs.** Walk through `.env.local` line by line and confirm each value belongs to the new client.

### C3. Install dependencies

```bash
npm install
```

### C4. Open the new directory as its own VS Code window

```bash
code ~/projects/clients/chariot
```

Opening it as a separate window (not as a folder inside the existing window) is what gives Claude Code an isolated session:

- Claude Code reads CLAUDE.md from the workspace root.
- Claude Code memory lives at `~/.claude/projects/-Users-<you>-projects-clients-chariot/memory/` — distinct from the original repo's memory.
- The integrated terminal's `cwd` is the new folder, so `npm run dev`, scripts, and `node -e` snippets all read this client's `.env.local`.

### C5. Run and verify

```bash
npm run dev
```

Open `http://localhost:3000` and confirm:

- The login page appears (no DB connection error).
- A test login with the new client's seeded admin account works (proves it's hitting the right DB).
- Branding, training-provider name, etc. match the new client (proves the right `training_provider` row).

If you see Tertiary's data, your `.env.local` is still pointing at the original DB — stop and fix before doing anything else.

### C6. Pulling upstream changes

The clone (or worktree) tracks the same `origin/main` as the original repo, so updates are routine:

```bash
git fetch origin
git pull origin main
npm install   # if package.json changed
npm run dev
```

If you've made client-specific code changes on a branch, rebase or merge onto `main` the same way. The longer you let custom changes diverge from `main`, the harder updates become — keep customizations behind feature flags or in `training_provider` config rows where possible, rather than in code.

### C7. What does *not* need to change when you rename the directory

For reference, none of these care about the folder name (so renaming `ai-lms-tms` → `chariot` is safe):

- TypeScript path aliases (`@components`, `@lib`, etc.) — resolved from project root.
- `package.json` `name` field — pure metadata, edit if you want consistency.
- `next.config.js`, `tsconfig.json` — directory-name-independent.
- `docker-compose.yml` — Compose uses the folder name as the *project* name (so containers become `chariot-app-1`, `chariot-postgres-1`), which is helpful for isolating clients on the same host, not a problem.

Things that **do** need updating after a rename:

- Personal shell aliases or scripts that hardcode `~/projects/tertiary/ai-lms-tms`.
- VS Code workspace files (`.code-workspace`) if you use them.
- Any external CI/CD pointing at a specific local path (rare).

### C8. Branch hygiene — never push a client clone to `main`

A client clone (Chariot, etc.) shares its `origin` with the canonical Tertiary repo. Without guard rails, a stray `git push` from this directory will publish client-specific commits — secrets, branding, hot fixes — onto the shared `main` branch. Treat every client clone as **forbidden from writing to `main`** and set up three layers of defence the moment you finish cloning:

1. Always work on a **client-namespaced branch** (`<client>/local-dev`, never `main`).
2. Point `git push` at a **fake push remote** so a bare `git push` fails noisily instead of going to `origin`.
3. Install a **pre-push hook** that refuses any push targeting `refs/heads/main` (or `master`), no matter which remote.

#### C8.1 Create the client branch and set push.default

Run this once, immediately after `git clone` (or `git worktree add`):

```bash
cd ~/projects/clients/chariot

# Create and switch to a client-namespaced branch
git checkout -b chariot/local-dev

# Make `git push` (no args) push the *current* branch only — never main by accident
git config push.default current
```

#### C8.2 Disable the default push remote

Repoint `origin`'s push URL at a fake target so `git push` without an explicit remote fails. Fetches still work, so you can pull upstream changes normally.

```bash
# Keep fetch URL pointing at the real origin; break only push
git remote set-url --push origin no_push

# Verify
git remote -v
# origin  https://github.com/alfredang/AI-LMS-TMS.git (fetch)
# origin  no_push                                     (push)
```

| Action | Result |
|---|---|
| `git push` on `chariot/local-dev` | Fails — `no_push` is not a valid remote |
| `git push origin chariot/local-dev` | Succeeds — explicit and intentional, creates a client branch on GitHub |
| `git push` while accidentally on `main` | Fails on `no_push` (and the pre-push hook below adds a second layer) |

#### C8.3 Install a pre-push hook that rejects `main`

The fake remote stops accidental bare pushes, but if someone *does* type `git push origin main` it would still go through. Add a `pre-push` hook to backstop that:

```bash
cat > .git/hooks/pre-push <<'HOOK'
#!/bin/sh
# Reject any push whose remote ref is main or master.
# Client clones must never write to the shared upstream main branch.
while read local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/main|refs/heads/master)
      echo "❌ Refused: push to $remote_ref is blocked in this client clone." >&2
      echo "   Push to a client-namespaced branch instead, e.g.:" >&2
      echo "     git push origin chariot/local-dev" >&2
      exit 1
      ;;
  esac
done
exit 0
HOOK
chmod +x .git/hooks/pre-push
```

> **Why a hook and not just the fake remote?** `.git/hooks/` is per-clone and not committed, so each client clone gets its own copy. The hook fires *before* any push regardless of the remote name, catching the case where someone re-adds a real push URL or pushes to a different remote entirely.

#### C8.4 Verify the guard rails

```bash
# Should fail at the fake remote
git push
# fatal: 'no_push' does not appear to be a git repository

# Should fail at the hook even with an explicit remote
git push origin main
# ❌ Refused: push to refs/heads/main is blocked in this client clone.

# Should succeed (the intended workflow)
git push origin chariot/local-dev
```

#### C8.5 Day-to-day workflow from here

```bash
git status                                # confirms chariot/local-dev
# edit, commit freely
git add <files>
git commit -m "chariot: …"
# git push   ← safely fails (no_push)

# Publish to GitHub only when you mean it:
git push origin chariot/local-dev
# then open a PR if/when changes need to flow back to upstream
```

Pull upstream `main` into the client branch the usual way:

```bash
git fetch origin
git rebase origin/main      # or: git merge origin/main
```

If a client-specific commit ever needs to land on the shared `main`, push it from the **Tertiary** working directory (not the client clone) after review — keeping the directional flow `client clone → PR → upstream main` explicit, never silent.

## Appendix D: Connecting Local Dev to a Client's Coolify Database (Worked Example: Chariot)

When a client's stack is deployed via the Docker Compose flow in Steps 5–8, Postgres runs as the `db` service **inside** the same Coolify resource as the Next.js app — it does **not** appear under Coolify's standalone "Databases" section. This appendix shows how to point a local dev workspace at that DB, using **Chariot** as the worked example.

> **Safety note:** Pointing local dev at a *production* DB lets a single mistyped `UPDATE` or migration script wreck live data. Prefer a dev/staging DB. If you must connect to production, treat it as read-only by default and confirm the target on every session (see D6).

### D1. Clone into a client-specific folder

The directory name is purely organisational — code, `package.json`, and Compose are folder-name independent (see [C7](#c7-what-does-not-need-to-change-when-you-rename-the-directory)).

```bash
git clone https://github.com/alfredang/AI-LMS-TMS.git ~/projects/clients/chariot
cd ~/projects/clients/chariot
```

Or, if you'd rather share `.git` with the existing checkout:

```bash
cd ~/projects/tertiary/ai-lms-tms
git worktree add ~/projects/clients/chariot main
```

### D2. Collect the DB connection details from Coolify

Open the Chariot Coolify resource (`Projects → Chariot Learning LMS → production`) and click into the `db` service. Note:

- **VPS IP** of the Hostinger host running Coolify (e.g. `203.0.113.20`)
- **`DB_PASSWORD`** — the value you set in [Step 6.1](#61-required-variables-must-set-before-first-deploy)
- **`DB_NAME`** — `lmsdb` unless you changed it
- **Host port** — `6434` (mapped to container's `5432` in `docker-compose.yml`)

### D3. Choose a connection method

**Option A — SSH tunnel (recommended).** Keeps Postgres firewalled to localhost on the VPS; nothing extra exposed to the public internet.

> **You must keep this tunnel open the entire time `npm run dev` is running.** The tunnel is a separate terminal process — closing it (or letting the SSH session time out) immediately breaks every DB query the local app makes. Treat opening the tunnel as a prerequisite to `npm run dev`, not an optional setup step.

**Open a NEW terminal window** (do not reuse the one you'll run `npm run dev` in) and run:

```bash
ssh -L 6434:localhost:6434 root@203.0.113.20
# Leave this window open and logged in. Do not close it.
# When it asks for password / MFA, complete it. The shell prompt
# stays open — that's the tunnel. Type `exit` to close it later.
```

What this does: the `-L 6434:localhost:6434` flag forwards your laptop's port 6434 through SSH to port 6434 on the VPS, where Coolify's Postgres container is listening. Anything that connects to `localhost:6434` on your laptop is actually reaching the Chariot DB.

Then, in your **app terminal** (a different window, where you'll later run `npm run dev`), set:

```bash
# In .env.local
DATABASE_URL=postgres://postgres:<DB_PASSWORD>@localhost:6434/lmsdb
```

**Option B — direct connection.** Requires opening port `6434` on the VPS firewall *only* to your office/home IP. Do not open `6434` to `0.0.0.0/0`.

```bash
# In .env.local
DATABASE_URL=postgres://postgres:<DB_PASSWORD>@203.0.113.20:6434/lmsdb
```

Default to A unless there's a specific reason. UFW example for B:

```bash
ssh root@203.0.113.20 "ufw allow from <your-public-ip> to any port 6434 proto tcp"
```

#### Troubleshooting the tunnel

| Symptom | Cause | Fix |
|---|---|---|
| `npm run dev` logs `ECONNREFUSED 127.0.0.1:6434` | Tunnel terminal was closed or timed out | Re-open it: `ssh -L 6434:localhost:6434 root@<vps-ip>` in a fresh terminal |
| `bind: Address already in use` when opening the tunnel | Old tunnel still running, or another process is on `6434` | `lsof -iTCP:6434 -sTCP:LISTEN` to find the PID, then `kill <pid>` |
| Tunnel opens but queries hang | Postgres container in Coolify is down | Check `db` service logs in the Chariot Coolify resource |
| Tunnel keeps dying after a few minutes | SSH idle timeout on VPS or laptop | Add `-o ServerAliveInterval=60` to the ssh command, or add `ServerAliveInterval 60` to `~/.ssh/config` |

For a longer-lived tunnel that survives sleep/wake cycles, run it under `autossh` instead:

```bash
brew install autossh   # macOS
autossh -M 0 -N -L 6434:localhost:6434 root@203.0.113.20
```

`-N` means "no remote command" (don't open a shell, just forward); `-M 0` disables autossh's own monitor port and relies on SSH keepalives instead.

### D4. Create the Chariot `.env.local` from Coolify's env vars

`.env.local` is gitignored — every working directory needs its own. The fastest, least error-prone way to populate it is to **mirror the env vars Coolify is already using** for the Chariot app, since those are the values the deployed instance actually runs against. This is what guarantees `JWT_SECRET`, `DB_PASSWORD`, OAuth secrets, etc. all match between local and prod.

#### D4.1 Find Coolify's env vars

1. Open Coolify → `Projects → Chariot Learning LMS → production`.
2. Click into the application (the Docker Compose resource — the only card under **Applications**).
3. Click the **`app`** service (the Next.js container, *not* the `db` service).
4. Go to the **"Environment Variables"** tab.

You'll see every variable from [Step 6](#step-6-set-environment-variables) listed: `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `NEXT_PUBLIC_BASE_URL`, `ADMIN_EMAIL`, `ANTHROPIC_API_KEY`, etc. Secrets are masked by default — click the **eye icon** next to each one to reveal the value.

> **Two convenient bulk options.** Most Coolify versions expose either:
> - a **"Developer view"** / **"Show all"** toggle that shows every var as raw `KEY=VALUE` lines — copy the whole block; or
> - a **"Download .env"** button at the top of the Environment Variables tab — downloads a file you can use as a starting point.
>
> If neither shows up in your Coolify version (UI varies per release), fall back to revealing and copying each variable individually.

#### D4.2 Translate Coolify values into local `.env.local`

Start from the existing template, then overwrite the keys you just copied:

```bash
cp ~/projects/tertiary/ai-lms-tms/.env.local .env.local
# or, if Coolify gave you a downloaded file:
# cp ~/Downloads/chariot-production.env .env.local
```

Then edit — most values copy across **unchanged**, but a few must be rewritten for local use:

| Variable | Source | Local override |
|---|---|---|
| `DB_PASSWORD` | Coolify (copy as-is) | — |
| `DB_NAME` | Coolify (`lmsdb`) | — |
| `JWT_SECRET` | Coolify (copy as-is) | — must match, otherwise existing user tokens won't validate |
| `DIRECT_APPLICATION_EMAIL_INGEST_TOKEN` | Coolify (copy as-is) | — must match Google Apps Script `TMS_BEARER_TOKEN` when email ingest is enabled |
| `ANTHROPIC_API_KEY` | Coolify (copy as-is) | — |
| `GOOGLE_OAUTH_*`, `QBO_*`, SSG certs | Coolify (copy as-is) | — |
| `DATABASE_URL` | **Build locally**, not from Coolify | `postgres://postgres:<DB_PASSWORD>@localhost:6434/lmsdb` (uses the SSH tunnel from D3, **not** the in-Docker hostname Coolify uses) |
| `NEXT_PUBLIC_BASE_URL` | **Override** | `http://localhost:3000` (Coolify's value is `https://lms.chariot.com` — wrong for local) |
| `NODE_ENV` | **Override** | `development` (Coolify uses `production`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_FULL_NAME`, `COMPANY_NAME`, `TRAINING_PARTNER_UEN` | Skip | These only run on first boot from an empty `postgres_data` volume — the local app reads `training_provider` from the DB, not these vars. Including them is harmless but does nothing. |

> **Why `DATABASE_URL` differs from Coolify's setup.** Inside the Coolify Docker network, the app reaches Postgres at the service hostname `db:5432` (set automatically by Compose). On your laptop there's no `db` host — you're tunnelling to the VPS's published port `6434`. So even though `DB_PASSWORD` and `DB_NAME` are copied verbatim, the *URL* must be reconstructed for local use.

#### D4.3 Don't cross client secrets

Walk through every variable in `.env.local` and confirm it belongs to **Chariot**, not Tertiary. The starter template you copied from `~/projects/tertiary/ai-lms-tms/.env.local` is Tertiary's — anything you didn't explicitly overwrite from Coolify is still pointing at Tertiary's resources.

**Crossing client secrets is worse than crossing DBs** — a stale `QBO_REFRESH_TOKEN` will cheerfully post Chariot invoices into Tertiary's QuickBooks; a stale `GOOGLE_OAUTH_REFRESH_TOKEN` will send Chariot OTP emails from Tertiary's Gmail account.

A quick sanity grep before running anything:

```bash
grep -iE "tertiary|@tertiaryinfotech" .env.local
# Expected: no matches. Any hit is almost certainly a leftover from the template.
```

### D5. Install and open in VS Code as its own window

```bash
npm install
code ~/projects/clients/chariot
```

Opening as a *separate* VS Code window (not a folder inside the existing window) gives Claude Code an isolated memory namespace at `~/.claude/projects/-Users-<you>-projects-clients-chariot/memory/`, so Tertiary memories don't bleed into Chariot work.

### D6. Verify before any write

> **Confirm the SSH tunnel is up first** (Option A). The tunnel terminal must be open and showing a logged-in shell prompt at `root@<vps-ip>`. If it's closed, re-open it before going further — every command below will fail with `connection refused` otherwise.

Run this **every** time you start a session against Chariot, before running migrations or writes:

```bash
psql "$DATABASE_URL" -c "SELECT company_name, uen FROM training_provider;"
```

Expected output: Chariot's company name and UEN. If it returns Tertiary, your `.env.local` (or your tunnel) is pointing at the wrong host — **stop**, fix it, do not proceed.

Then start the dev server and sanity-check the UI:

```bash
npm run dev
```

At `http://localhost:3000`:
- Login screen shows Chariot branding (proves the right `training_provider` row).
- Logging in with Chariot's seeded admin works (proves `JWT_SECRET` matches and the user table is the right one).

### D7. Caveats

- **Migrations.** `npm run db:migrate` against a production DB will run irreversible schema changes. Only do this if you have a fresh `pg_dump` backup taken minutes ago (see [Backup Recommendations](#backup-recommendations)).
- **Scheduler.** The dev server starts its own in-process `node-cron` scheduler. If it points at a production DB, **disable scheduled tasks** via the Admin UI before `npm run dev`, or both the local and the deployed scheduler will fire (e.g. duplicate certificate emails to learners).
- **Uploads.** File uploads in local dev write to your laptop's `public/uploads/`, not the VPS's `uploads_data` volume. The DB will reference paths that don't exist on production — clean up test rows before you log off.

---
---

## Appendix E: Adding Another Client Clone Alongside Existing Ones (Worked Example: Intellisoft)

Once you've set up Chariot using Appendices C and D, adding the next client (Intellisoft, in this example) follows the same shape but needs three extra things:

1. A **second pre-push hook** in the new clone (hooks live in `.git/hooks/` — per-clone, not committed).
2. A **Claude Code deny hook** as belt-and-suspenders for AI-driven mistakes.
3. **Non-clashing local ports** for the SSH tunnel and dev server, so Chariot and Intellisoft can run simultaneously without fighting for `6434` / `3000`.

This appendix is the recipe. Substitute `intellisoft` → your client name throughout.

### E1. Clone into a separate directory (don't reuse Chariot's folder)

```bash
cd ~/projects/clients
git clone https://github.com/alfredang/AI-LMS-TMS.git intellisoft
cd intellisoft
```

> **Why a separate folder.** Each client clone keeps its own `.env.local`, its own `.git/hooks/`, its own Claude Code memory, and (after step E5) listens on a different dev port. Mixing them in one folder is the easy way to write Chariot data into Intellisoft's DB.

Then immediately apply the C8 branch hygiene baseline:

```bash
git checkout -b intellisoft/local-dev
git config push.default current
git remote set-url --push origin no_push
```

### E2. Install the pre-push hook (block pushes to `main`)

This is the same hook from C8.3, but the message is namespaced to Intellisoft so the operator immediately knows which clone they're in if it ever fires.

```bash
cat > .git/hooks/pre-push <<'EOF'
#!/bin/sh
protected_branch='main'
remote="$1"
while read local_ref local_sha remote_ref remote_sha; do
    if [ "$remote_ref" = "refs/heads/$protected_branch" ]; then
        echo ""
        echo "🚫 BLOCKED: push to '$protected_branch' on remote '$remote'"
        echo "   This clone is for Intellisoft client work. Pushing to main"
        echo "   would deploy to all tenants on alfredang/AI-LMS-TMS."
        echo ""
        echo "   To push a feature branch instead:"
        echo "     git push origin \$(git branch --show-current)"
        echo ""
        exit 1
    fi
done
exit 0
EOF
chmod +x .git/hooks/pre-push
```

Verify:

```bash
git push origin main
# 🚫 BLOCKED: push to 'main' on remote 'origin'
```

### E3. Add a Claude Code deny hook (belt-and-suspenders for AI sessions)

If you use Claude Code in this clone, the assistant has access to `git push` via the Bash tool. The git pre-push hook above stops it at the git layer, but you can stop it one layer earlier — at Claude Code's permission system — so the LLM gets a clear "denied with reason" before any shell command runs. This catches the case where Claude tries to use `--force` or some other variant that might surprise the git hook.

```bash
mkdir -p .claude
cat > .claude/settings.local.json <<'EOF'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "cmd=$(jq -r '.tool_input.command // \"\"'); if echo \"$cmd\" | grep -qE 'git[[:space:]]+push([[:space:]]+[^[:space:]]+)*[[:space:]]+(HEAD:)?main(\\b|$)'; then printf '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Blocked: this Intellisoft clone forbids pushing to main. Use a feature branch (e.g. intellisoft/local-dev) instead.\"}}'; fi"
          }
        ]
      }
    ]
  }
}
EOF
```

> **What this does.** Before Claude Code runs any `Bash` tool, it runs this hook. The hook reads the proposed shell command from stdin (as JSON), and if the regex matches `git push ... main` (with or without `HEAD:` prefix, with or without intermediate args), it returns a structured `deny` decision. Claude sees the reason and picks a different approach — usually pushing to the feature branch — without ever invoking the shell.
>
> `.claude/settings.local.json` is gitignored by default. Like `.git/hooks/`, it's a per-clone safeguard you re-install for every new client folder.

### E4. Create `.env.local` from a sibling clone, then rewrite the client-specific bits

Copying from Chariot is faster than re-deriving every variable from scratch — you'll keep the dev-only values and the same env-var *shape*, then overwrite anything client-specific.

```bash
cp ~/projects/clients/chariot/.env.local .env.local
```

Then open `.env.local` and change the following. Use the Coolify "Environment Variables" tab on Intellisoft's resource as the source of truth (see [D4.1](#d41-find-coolifys-env-vars)):

| Variable | Source | Value for Intellisoft |
|---|---|---|
| `DB_HOST` / `DB_PORT` | tunnel-driven | `localhost` / `6435` (different local port — see E5) |
| `DB_PASSWORD` | Coolify | Intellisoft's value |
| `DATABASE_URL` | construct locally | `postgres://postgres:<DB_PASSWORD>@localhost:6435/lmsdb` |
| `JWT_SECRET` | Coolify | Intellisoft's value (must match the deployed app) |
| `COMPANY_NAME` | Coolify | `Intellisoft Pte Ltd` (or whatever the real name is) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Coolify | Intellisoft's first-boot admin creds |
| `ANTHROPIC_API_KEY`, Google OAuth, QBO, SSG | Coolify | Intellisoft's keys, **not** Chariot's |
| `NEXT_PUBLIC_BASE_URL` | local | `http://localhost:3031` (matches the dev port from E5) |
| `NODE_ENV` | local | `development` |

Run the cross-client safety grep before `npm run dev`:

```bash
grep -iE "chariot|tertiary" .env.local
# Expected: no matches. Any hit is a leftover from copying Chariot's template — fix it.
```

### E5. SSH tunnel on a different local port

Chariot already uses `6434` on your laptop. To run both clients at once, forward Intellisoft to a different local port (the **remote** port stays `6434` — that's the host port Coolify's Compose maps Postgres to, identical on every VPS).

In a **new terminal window**, leave open while developing:

```bash
ssh -L 6435:localhost:6434 root@<INTELLISOFT_VPS_IP>
```

Now:
- `localhost:6434` → Chariot's Postgres (existing tunnel)
- `localhost:6435` → Intellisoft's Postgres (this new tunnel)

`DATABASE_URL` in Intellisoft's `.env.local` points at `localhost:6435`. Chariot's still points at `localhost:6434`. They never collide.

If you add a third client later, use `6436`, then `6437`, etc.

### E6. Different dev server port

Next.js defaults to `3000`. If Chariot's dev server is already running there, Intellisoft's will fail to bind. Set `PORT` per client:

```bash
# One-off
PORT=3031 npm run dev
```

Or bake into a per-client npm script if you'd rather not remember:

```bash
# Edit package.json scripts in this clone only (it's gitignored from the user's PoV
# because you never push from this clone — but it WILL show as modified in git)
# Easier alternative: keep a shell alias in your dotfiles
alias dev:intellisoft='cd ~/projects/clients/intellisoft && PORT=3031 npm run dev'
alias dev:chariot='cd ~/projects/clients/chariot && PORT=3030 npm run dev'
```

Suggested port allocation:

| Client | Tunnel local port | Dev server port |
|---|---|---|
| Tertiary (canonical repo) | n/a (uses local Postgres or own staging) | `3000` |
| Chariot | `6434` | `3030` |
| Intellisoft | `6435` | `3031` |
| Next client | `6436` | `3032` |

Update Intellisoft's `NEXT_PUBLIC_BASE_URL` in `.env.local` to match the chosen port: `http://localhost:3031`.

### E7. Install dependencies and run

```bash
npm install
PORT=3031 npm run dev
```

Open `http://localhost:3031` and verify before doing anything else:

```bash
psql "$DATABASE_URL" -c "SELECT company_name, uen FROM training_provider;"
# Expected: Intellisoft. Anything else → stop, your tunnel or env is wrong.
```

### E8. Open as its own VS Code window

```bash
code ~/projects/clients/intellisoft
```

A separate VS Code window keeps Claude Code memory isolated to `~/.claude/projects/-Users-<you>-projects-clients-intellisoft/memory/`, so prior Chariot context doesn't leak into Intellisoft work.

### E9. Quick reference: full setup script for a new client

For copy-paste reuse when onboarding the *next* client. Replace `<CLIENT>` and `<VPS_IP>` and pick free ports:

```bash
CLIENT=intellisoft
VPS_IP=<INTELLISOFT_VPS_IP>
LOCAL_DB_PORT=6435
DEV_PORT=3031

cd ~/projects/clients
git clone https://github.com/alfredang/AI-LMS-TMS.git "$CLIENT"
cd "$CLIENT"

# Branch hygiene (C8)
git checkout -b "$CLIENT/local-dev"
git config push.default current
git remote set-url --push origin no_push

# Pre-push hook (E2) — paste the heredoc from above

# Claude Code deny hook (E3) — paste the heredoc from above

# Env from a sibling, then edit
cp ~/projects/clients/chariot/.env.local .env.local
# ... edit DATABASE_URL, JWT_SECRET, COMPANY_NAME, etc.

npm install

# In a separate terminal:
ssh -L "$LOCAL_DB_PORT":localhost:6434 "root@$VPS_IP"

# Back in this terminal:
PORT="$DEV_PORT" npm run dev
```

That's the entire onboarding for a new client clone, end to end.
