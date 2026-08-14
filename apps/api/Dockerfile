FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S servicepilot && adduser -S servicepilot -G servicepilot
COPY --from=build --chown=servicepilot:servicepilot /app/package.json /app/package-lock.json ./
COPY --from=build --chown=servicepilot:servicepilot /app/node_modules ./node_modules
COPY --from=build --chown=servicepilot:servicepilot /app/dist ./dist
USER servicepilot
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -q -O - http://127.0.0.1:8000/health/live || exit 1
CMD ["node", "dist/main.js"]
