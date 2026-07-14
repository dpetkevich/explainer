# The self-serve web app: one always-on service that also runs headless Chromium
# for scene QA. The official Playwright image ships Node 20 + Chromium + all the
# system libraries the browser needs, which a plain node image does not.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Install deps first for layer caching (better-sqlite3 compiles here).
COPY package.json package-lock.json ./
RUN npm ci

# Make sure the browser build matches the installed Playwright version.
RUN npx playwright install chromium

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

# Persist the SQLite db + uploads (/data) and the generated artifacts
# (/app/explainers). Mount volumes for both on the host / platform.
VOLUME ["/data", "/app/explainers"]

EXPOSE 3000
CMD ["npm", "run", "serve"]
