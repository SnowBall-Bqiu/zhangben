# syntax=docker/dockerfile:1

FROM node:24-slim AS client-deps
WORKDIR /app/client
RUN npm config set registry https://registry.npmmirror.com
COPY client/package*.json ./
RUN npm ci

FROM node:24-slim AS client-build
WORKDIR /app
COPY --from=client-deps /app/client/node_modules ./client/node_modules
COPY VERSION ./VERSION
COPY client ./client
RUN npm run build --prefix client

FROM node:24-slim AS server-deps
WORKDIR /app/server
RUN sed -i 's|http://deb.debian.org|http://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
  && sed -i 's|https://mirrors.tuna.tsinghua.edu.cn|http://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci --omit=dev --registry=https://registry.npmmirror.com \
  && npm cache clean --force

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  DATA_DIR=/app/data \
  SESSION_COOKIE_SECURE=false \
  PORT=3000
WORKDIR /app
RUN groupadd --system nodeapp \
  && useradd --system --gid nodeapp --home /app nodeapp \
  && mkdir -p /app/data \
  && chown -R nodeapp:nodeapp /app
COPY --chown=nodeapp:nodeapp --from=server-deps /app/server/node_modules ./server/node_modules
COPY --chown=nodeapp:nodeapp server ./server
COPY --chown=nodeapp:nodeapp --from=client-build /app/client/dist ./client/dist
USER nodeapp
EXPOSE 3000
CMD ["node", "server/index.js"]
