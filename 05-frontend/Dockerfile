# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# use `npm ci` when a lockfile is present (reproducible), else `npm install`
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
# public/ assets may carry restrictive host perms — make them world-readable for nginx
RUN chmod -R a+rX public 2>/dev/null || true
ARG VITE_API_BASE=/api/v1
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build && chmod -R a+rX dist

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
