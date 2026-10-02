FROM node:24-alpine

RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont tzdata dumb-init

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY admin-dashboard ./admin-dashboard
COPY session-map ./session-map
COPY admin-server.js container-runner.js linux-daemon.js local-env.js tracking-service.js ./

RUN mkdir -p /app/data /app/config && chown node:node /app/data /app/config

USER node

ENV NODE_ENV=production \
    CHROME_EXECUTABLE=/usr/bin/chromium-browser \
    TRACKER_HEADLESS=true \
    DATA_DIR=/app/data \
    USERS_FILE=/app/config/users.local.json \
    ADMIN_DASHBOARD_HOST=0.0.0.0 \
    ADMIN_DASHBOARD_PORT=8787 \
    TZ=Europe/Stockholm

EXPOSE 8787

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "container-runner.js"]
