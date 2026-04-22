# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

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

# Install Playwright chromium browser + required system libs. The brochure
# generator (scripts/generate-brochure.py) and any other Streamlit-origin
# Python helpers call Python Playwright from this venv; no Node Playwright
# is used at runtime.
RUN playwright install --with-deps chromium

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
