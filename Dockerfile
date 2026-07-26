# Build stage: install everything and build the client
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY vite.config.js ./
COPY client ./client
RUN npm run build

# Runtime stage: server + built client + vendored emulator only
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund
COPY server ./server
COPY --from=build /app/dist ./dist

# All persistent data (lobbies, ROMs, saves) lives at /data — attach the
# platform's persistent volume there (Railway: Attach Volume, mount /data).
# No Docker VOLUME directive: Railway's builder rejects it.
ENV NUZ_DATA_DIR=/data

ENV PORT=4517
EXPOSE 4517
CMD ["node", "server/server.js"]
