FROM node:22-alpine AS base
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN apk add --no-cache python3 make g++ chromium

FROM base AS shared-builder
COPY fantasy-engine/shared/package*.json /app/fantasy-engine/shared/
WORKDIR /app/fantasy-engine/shared
RUN npm ci
COPY fantasy-engine/shared/ /app/fantasy-engine/shared/
RUN npm run build

FROM base AS automation-builder
COPY --from=shared-builder /app/fantasy-engine/shared /app/fantasy-engine/shared
COPY fantasy-engine/automation/package*.json /app/fantasy-engine/automation/
WORKDIR /app/fantasy-engine/automation
RUN npm ci
COPY fantasy-engine/automation/ /app/fantasy-engine/automation/
RUN npm run build

FROM base AS mcp-builder
COPY --from=shared-builder /app/fantasy-engine/shared /app/fantasy-engine/shared
COPY fantasy-engine/mcp-server/package*.json /app/fantasy-engine/mcp-server/
WORKDIR /app/fantasy-engine/mcp-server
RUN npm ci
COPY fantasy-engine/mcp-server/ /app/fantasy-engine/mcp-server/
RUN npm run build

FROM base AS server-builder
COPY fantasy-engine/server/package*.json /app/fantasy-engine/server/
WORKDIR /app/fantasy-engine/server
RUN npm ci
COPY fantasy-engine/server/ /app/fantasy-engine/server/
RUN npm run build

FROM node:22-alpine AS runtime-shared
WORKDIR /app/shared
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true
COPY --from=shared-builder /app/fantasy-engine/shared/package*.json ./
COPY --from=shared-builder /app/fantasy-engine/shared/dist ./dist
RUN npm ci --omit=dev && mkdir -p /app/shared/data && chown node:node /app/shared/data

FROM runtime-shared AS runtime-mcp
WORKDIR /app/mcp-server
COPY --from=mcp-builder /app/fantasy-engine/mcp-server/package*.json ./
COPY --from=mcp-builder /app/fantasy-engine/mcp-server/dist ./dist
RUN npm ci --omit=dev
USER node
ENTRYPOINT ["node", "dist/index.js"]

FROM runtime-shared AS runtime-automation
WORKDIR /app/automation
COPY --from=automation-builder /app/fantasy-engine/automation/package*.json ./
COPY --from=automation-builder /app/fantasy-engine/automation/dist ./dist
RUN npm ci --omit=dev && chown -R node:node /app/automation
USER node
ENTRYPOINT ["node", "dist/cli.js"]

FROM node:22-alpine AS runtime-web
WORKDIR /app/server
ENV NODE_ENV=production \
    PORT=3003 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN apk add --no-cache chromium
COPY --from=server-builder /app/fantasy-engine/server/package*.json ./
COPY --from=server-builder /app/fantasy-engine/server/dist ./dist
COPY --from=server-builder /app/fantasy-engine/server/public ./public
RUN npm ci --omit=dev
USER node
EXPOSE 3003
CMD ["node", "dist/index.js"]

FROM runtime-web AS runtime-poc

FROM base AS dev
WORKDIR /app
COPY . /app
RUN npm ci --prefix fantasy-engine/shared \
    && npm run build --prefix fantasy-engine/shared \
    && npm ci --prefix fantasy-engine/automation \
    && npm ci --prefix fantasy-engine/mcp-server \
    && npm ci --prefix fantasy-engine/server \
    && chown -R node:node /app
WORKDIR /app/fantasy-engine/server
USER node
EXPOSE 3003
CMD ["npm", "run", "dev"]