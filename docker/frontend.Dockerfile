# Frontend: build with Vite, serve only the static dist/ with nginx.
FROM node:22-alpine AS build
WORKDIR /frontend
RUN corepack enable
# pnpm-lock.yaml is gitignored, so this can't be a frozen install
COPY frontend/package.json frontend/pnpm-workspace.yaml ./
RUN pnpm install
COPY frontend/ .
RUN pnpm build

FROM nginx:alpine
COPY --from=build /frontend/dist /usr/share/nginx/html
EXPOSE 80
