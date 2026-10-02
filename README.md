# Serviceresor Live Tracking

Containerized service that reads today's Serviceresor trips, checks for cancellations, and creates encrypted live maps. Map links can be sent via 46elks, TextBee, and/or ntfy. Maps close after 60 minutes.

## Requirements

- Docker Engine with Compose plugin
- A Serviceresor account for each user

## Quick start

```bash
git clone --branch feature/installer-improvements https://github.com/kalle42/serviceresor-live-tracking.git
cd serviceresor-live-tracking
cp users.example.json users.local.json
cp .env.docker.example .env.docker
```

Edit `users.local.json` with real Serviceresor credentials and notification recipients. Set an admin password (minimum 12 characters) and a here.now API key in `.env.docker`. 46elks, TextBee, and ntfy are optional.

Validate and start:

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs -f
```

When `docker compose ps` shows `healthy`, the admin dashboard is available at `http://127.0.0.1:8787`. Log in as `admin` with the password from `.env.docker`. The port is bound to localhost only.

Restart after configuration changes:

```bash
docker compose up -d --force-recreate
```

Stop the service:

```bash
docker compose down
```

## Configuration

### `users.local.json`

Contains Serviceresor usernames, personnummer, passwords, and notification targets. Copied from `users.example.json` on first setup. Editable from the admin dashboard. Mounted into the container from the project directory.

### `.env.docker`

Environment variables for the container. Copied from `.env.docker.example`. Not built into the image.

| Variable | Required | Description |
|---|---|---|
| `ADMIN_DASHBOARD_PASSWORD` | Yes | Minimum 12 characters |
| `HERENOW_API_KEY` | Yes | here.now API key |
| `ELKS_API_USERNAME` | No | 46elks API username |
| `ELKS_API_PASSWORD` | No | 46elks API password |
| `TEXTBEE_API_KEY` | No | TextBee API key |
| `TEXTBEE_DEVICE_ID` | No | TextBee device ID |
| `TEXTBEE_BASE_URL` | No | TextBee API base URL |
| `NTFY_SERVER_URL` | No | ntfy server URL |
| `NTFY_ACCESS_TOKEN` | No | ntfy access token |

## Data and persistence

Plans, sessions, and process registers are stored in the Docker volume `serviceresor-data`. The volume survives `docker compose down`; use `docker compose down -v` to also remove saved data.

## Troubleshooting

```bash
docker compose logs --tail 200 serviceresor
docker compose restart serviceresor
```

## Architecture

The container runs two Node.js processes under `dumb-init`:

- **admin-server.js** - HTTP dashboard on port 8787 with basic authentication
- **linux-daemon.js** - Daily planner that schedules trip tracking at 01:00 and spawns tracker processes 10 minutes before departure

Chromium is bundled in the image for headless browser automation. Map sessions are published to here.now with encrypted location data. The container runs as a non-root user with dropped capabilities and read-only tmpfs.

## Automatic scheduling

The planner runs at 01:00 and:

- Reads trips for today
- Checks for cancellation one hour before departure
- Starts tracking ten minutes before departure
- Monitors vehicle numbers continuously
- Sends the map link via configured channels
- Closes the map after 60 minutes

## Security

Never commit `.env.docker`, `users.local.json`, `.herenow`, session data, logs, or API keys. Rotate credentials that have been exposed.

Maps use OpenStreetMap with visible attribution, normal browser caching, no tile prefetch, and no offline downloads. See the [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) before changing the tile layer.