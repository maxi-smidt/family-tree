# Build the React SPA and serve it with nginx, which also proxies /api to the
# backend so the whole app is reachable on a single origin/port.
FROM node:24-alpine AS build

WORKDIR /app

ARG APP_VERSION=dev
ARG APP_REVISION=dev
ARG APP_BUILD_DATE=
ENV VITE_APP_VERSION=${APP_VERSION} \
    VITE_GIT_SHA=${APP_REVISION} \
    VITE_BUILD_DATE=${APP_BUILD_DATE}

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine
ARG APP_VERSION=dev
ARG APP_REVISION=dev
ARG APP_BUILD_DATE=
LABEL org.opencontainers.image.title="Family Tree Frontend" \
      org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.revision=${APP_REVISION} \
      org.opencontainers.image.created=${APP_BUILD_DATE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
