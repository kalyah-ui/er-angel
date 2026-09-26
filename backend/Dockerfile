FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Exact versions from the lockfile, no dev tools (nodemon). better-sqlite3
# downloads a prebuilt Linux binary here.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# /app/data (SQLite db + voice cache) is a Docker volume; created here so the
# volume starts out owned by the unprivileged "node" user.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/index.js"]
