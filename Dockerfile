# Stage 1: Install dependencies
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build Next.js standalone
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* vars must be present at build time (inlined into JS bundle).
# Railway passes service variables as Docker build args automatically.
ARG NEXT_PUBLIC_CONVEX_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_WORKOS_REDIRECT_URI
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_PREVIEW_FEATURES
ARG NEXT_PUBLIC_ENABLE_R2_ARTIFACT_DEBUG_PATH

RUN npm run build

# Stage 2b: Production runtime dependencies for worker + web runtime helpers
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 3: Production runner with R
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install system dependencies:
# - R + build tools: statistical computation, .sav file processing
# - LibreOffice: DOCX → PDF/HTML conversion (BannerAgent, SurveyProcessor)
# - GraphicsMagick + Ghostscript: PDF → PNG conversion (pdf2pic for AI vision)
RUN apt-get update && apt-get install -y --no-install-recommends \
    r-base \
    r-base-dev \
    build-essential \
    gfortran \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    zlib1g-dev \
    libreoffice-writer \
    graphicsmagick \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

# Install R packages and verify haven loaded successfully
RUN R -e "install.packages(c('haven', 'dplyr', 'jsonlite'), repos='https://cloud.r-project.org/')" \
    && Rscript -e "library(haven); cat('haven OK\n')"

# Copy standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/convex ./convex

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check using Node's built-in fetch (no extra deps needed)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
