# Caddy image for the server: HTTPS, the nurse dashboard, the hosted kiosk,
# and the /api proxy (config: deploy/Caddyfile). Built from the repo root
# (see /.dockerignore: only the two frontends go in, never any .env file).

FROM node:22-slim AS dashboard
WORKDIR /app
COPY frontend-dashboard/package.json frontend-dashboard/package-lock.json ./
RUN npm ci
COPY frontend-dashboard/ ./
# "/api" = same origin, proxied by Caddy.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM node:22-slim AS kiosk
WORKDIR /app
COPY frontend-kiosk/package.json frontend-kiosk/package-lock.json ./
RUN npm ci
COPY frontend-kiosk/ ./
# Same-origin "/api" on the kiosk host, which is public and only reaches
# kiosk endpoints (see deploy/Caddyfile). The kiosk token is deliberately NOT
# baked in -- a public bundle would leak it. (The local kiosk on laptops still uses its
# own .env.local token, unchanged.)
ENV VITE_API_URL=/api
ENV VITE_KIOSK_TOKEN=
RUN npm run build

FROM caddy:2-alpine
COPY --from=dashboard /app/dist /srv/dashboard
COPY --from=kiosk /app/dist /srv/kiosk
