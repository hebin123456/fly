# 国内拉不到 Docker Hub 时，可加 --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:20-alpine
ARG NODE_IMAGE=node:20-alpine
FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
    PORT=3000 \
    HTTPS_PORT=3443 \
    ENABLE_HTTPS=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY src ./src
COPY public ./public

USER node
EXPOSE 3000 3443

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]
