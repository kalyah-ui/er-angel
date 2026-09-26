# Production image: build the dashboard to static files, serve them with Caddy.
# (Caddy also terminates HTTPS and proxies /api to the backend -- see deploy/Caddyfile.)

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Baked into the bundle at build time. "/api" = same origin, proxied by Caddy.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
