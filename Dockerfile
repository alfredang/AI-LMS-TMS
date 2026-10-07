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

# next.config.js must have output: 'standalone'
RUN npm run build

# ── Stage 2: Production image (Debian — Python + Playwright chromium) ─────────
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Force the builder stage to complete before this stage starts its heavy work
# (apt installs, Python venv compilation, ~400 MB of Playwright Chromium
# downloads). Without this, BuildKit runs both stages in parallel and the peak
# memory pressure can OOM-kill the build on smaller servers. Copying a tiny
# always-changing file is enough to introduce the cross-stage dependency.
COPY --from=builder /app/package.json /tmp/_builder_ready.json
RUN rm -f /tmp/_builder_ready.json

# Install Python 3 runtime for courseware generator scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      ca-certificates \
      poppler-utils \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# LibreOffice (headless) converts learners' Mac Pages (.pages) assessment
# submissions to PDF so trainers can sign them (lib/assessment/pagesToPdf.ts).
# The official TDF build is used, not Debian's package: Debian's LibreOffice is
# built against the system libetonyek 0.1.10, which drops the text inside
# Pages answer boxes entirely. heif-convert decodes HEIC screenshots pasted
# into those documents. Only Writer is installed; unused bundled data is pruned.
ARG LIBREOFFICE_VERSION=26.2.6.3
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl libheif-examples fonts-liberation fonts-dejavu-core \
      libxinerama1 libdbus-1-3 libcairo2 libcups2 libx11-xcb1 libxrandr2 libnss3 libglib2.0-0 \
    && case "$(dpkg --print-architecture)" in \
         amd64) lo_dir=x86_64 lo_arch=x86-64 ;; \
         arm64) lo_dir=aarch64 lo_arch=aarch64 ;; \
         *) echo "Unsupported architecture for LibreOffice" >&2; exit 1 ;; \
       esac \
    && curl -fsSL "https://downloadarchive.documentfoundation.org/libreoffice/old/${LIBREOFFICE_VERSION}/deb/${lo_dir}/LibreOffice_${LIBREOFFICE_VERSION}_Linux_${lo_arch}_deb.tar.gz" -o /tmp/lo.tgz \
    && mkdir /tmp/lo && tar -xzf /tmp/lo.tgz -C /tmp/lo --strip-components=1 \
    && cd /tmp/lo/DEBS \
    && dpkg -i libreoffice*-ure_*.deb libreoffice[0-9]*.[0-9]_*.deb \
         libobasis*-core_*.deb libobasis*-writer_*.deb libreoffice*-writer_*.deb \
         libobasis*-en-us_*.deb libreoffice*-en-us_*.deb \
         libobasis*-graphicfilter_*.deb libobasis*-images_*.deb libobasis*-ooofonts_*.deb \
    && cd / && rm -rf /tmp/lo /tmp/lo.tgz /var/lib/apt/lists/* \
    && lo_home="$(ls -d /opt/libreoffice*)" \
    && rm -rf "$lo_home/help" "$lo_home/share/gallery" "$lo_home/share/template" "$lo_home/share/wizards" \
    && ln -sf "$lo_home/program/soffice" /usr/bin/soffice \
    && soffice --version

# Install Python packages used by scripts/*.py (docxtpl, requests, playwright, etc.).
# --prefer-binary tells pip to pick a wheel over an sdist whenever both
# exist, so a transient missing wheel for the *latest* version doesn't
# silently fall back to a source build that would fail on this slim image
# without the C toolchain.
COPY scripts/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --prefer-binary -r /tmp/requirements.txt \
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

# Pinned official client for OpenAI OAuth login and generation.
RUN npm install -g @openai/codex@0.149.0

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
