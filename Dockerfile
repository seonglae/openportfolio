# The app half of `docker compose up`: the functions to push, the browser to
# serve, and the sync worker. The backend is Convex's own self-hosted image and
# is not built here. See docker-compose.yml.
FROM node:22-bookworm-slim

WORKDIR /app
# The version package.json names, installed directly: corepack in older node
# images fails signature checks on newer pnpm releases.
RUN npm install -g pnpm@11.22.0

COPY . .
RUN pnpm install --frozen-lockfile

# The browser runs on the host, not in this network, so the URL compiled into
# the bundle is the published port and not http://backend:3210. Auth is off
# because the first book is created through OPENPORTFOLIO_DEV_TENANT, and the
# browser has no screen that creates one for a signed-in user.
ARG VITE_CONVEX_URL=http://127.0.0.1:3210
RUN VITE_CONVEX_URL=$VITE_CONVEX_URL VITE_DISABLE_AUTH=1 pnpm --filter openportfolio-browser build

ENTRYPOINT ["/app/docker/entrypoint.sh"]
