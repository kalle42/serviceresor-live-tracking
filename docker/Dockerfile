# Serviceresor/färdtjänst i behållare. Byggs från docker/ mappen:
#   docker compose build
# Se docker/README.md för uppsättning och körning.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Europe/Stockholm

# jq, file och curl krävs av publish.sh; Chrome körs via chrome-wrapper.sh
# som lägger till --no-sandbox så att appfilerna kan vara orörda kopior.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl jq file fonts-liberation tzdata \
    && curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/local/bin/chrome-wrapper \
    GIT_BASH_PATH=/bin/bash

WORKDIR /app

COPY chrome-wrapper.sh /usr/local/bin/chrome-wrapper
COPY app/ /app/
COPY scheduler.js entrypoint.sh /app/

# Radslut från Windows-utcheckning får inte följa med in i shellskripten.
RUN sed -i 's/\r$//' /usr/local/bin/chrome-wrapper /app/entrypoint.sh /app/tools/sha256sum /app/here-now/scripts/publish.sh \
    && chmod +x /usr/local/bin/chrome-wrapper /app/entrypoint.sh /app/tools/sha256sum /app/here-now/scripts/publish.sh \
    && npm ci --omit=dev

EXPOSE 8787

ENTRYPOINT ["/app/entrypoint.sh"]
