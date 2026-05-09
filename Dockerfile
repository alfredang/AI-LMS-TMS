# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# git is needed at build time so next.config.js can stamp the commit hash/date.
# safe.directory bypass is required because COPY-ed files are owned by root,
# which trips modern git's "dubious ownership" guard.
RUN apk add --no-cache git \
    && git config --global --add safe.directory '*'

COPY package*.json ./
RUN npm ci

COPY . .

# Diagnostic: surface whether .git made it into the build context and whether
# git can read it. Output goes to Coolify's build log. Always exits 0 so the
# build is not blocked by the probe itself.
RUN echo "=== version probe ===" \
    && (ls -la .git 2>&1 | head -5 || echo "NO .git directory") \
    && (git rev-parse HEAD 2>&1 || echo "git rev-parse FAILED") \
    && (git log -1 --format='%h %ci' 2>&1 || echo "git log FAILED") \
    && echo "=== end version probe ===" \
    || true

# next.config.js must have output: 'standalone'
RUN npm run build

# ── Stage 2: Production image (Debian — Python + Playwright chromium) ─────────
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Install Python 3 runtime for courseware generator scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      ca-certificates \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages used by scripts/*.py (docxtpl, requests, playwright, etc.)
COPY scripts/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm /tmp/requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

# Install Playwright chromium browser + required system libs (for brochure PDF rendering)
RUN playwright install --with-deps chromium

# lib/cw-brochure.ts uses the npm `playwright` package (not the Python one) to
# render the brochure PDF in Node. Node and Python playwrights look for the
# Chromium binary in different cache subfolders, so we have to install the
# Node-side browser separately. The Python venv is first on PATH (line above),
# which would shadow the Node `playwright` CLI — invoke it via its absolute
# install path instead. Chromium downloads to /root/.cache/ms-playwright.
RUN npm install -g playwright@1.59.1 \
    && /usr/local/bin/playwright install chromium

# Copy only what Next.js standalone needs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Ensure the uploads directory exists and is writable at runtime
RUN mkdir -p /app/public/uploads && chmod -R 755 /app/public/uploads

# Copy seed/init scripts so they can be run inside the container if needed
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/database ./database
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

CMD ["node", "server.js"]
