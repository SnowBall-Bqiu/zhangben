# syntax=docker/dockerfile:1

FROM node:24-slim AS client-deps
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci

FROM node:24-slim AS client-build
WORKDIR /app
COPY --from=client-deps /app/client/node_modules ./client/node_modules
COPY VERSION ./VERSION
COPY client ./client
RUN npm test --prefix client \
  && npm run build --prefix client

FROM node:24-slim AS server-deps
WORKDIR /app/server
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

FROM server-deps AS server-test
COPY server ./
RUN npm test

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  DATA_DIR=/app/data \
  SESSION_COOKIE_SECURE=true \
  PORT=3000
WORKDIR /app
RUN groupadd --gid 10001 nodeapp \
  && useradd --uid 10001 --gid nodeapp --home-dir /app --no-create-home --shell /usr/sbin/nologin nodeapp \
  && mkdir -p /app/data \
  && chown nodeapp:nodeapp /app/data
COPY --from=server-test /app/server/node_modules ./server/node_modules
COPY server ./server
COPY --from=client-build /app/client/dist ./client/dist
USER nodeapp
EXPOSE 3000
CMD ["node", "server/index.js"]
