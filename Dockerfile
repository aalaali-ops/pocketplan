FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_BASE_PATH=/
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_BASE_PATH=$VITE_BASE_PATH

COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runner
COPY deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=5s --retries=5 \
  CMD wget --quiet --spider http://127.0.0.1:8080/health || exit 1

