# Serviceresor Live Tracking

This project reads configured Serviceresor trips once per day and creates a separate, encrypted map session for each trip. A tracking URL is sent by SMS, ntfy, or both shortly before departure, and the temporary map is deleted automatically after 60 minutes.

## Requirements

- Windows 10 or later
- Node.js LTS
- Google Chrome
- Git for Windows and `jq`
- A here.now API key
- A 46elks account for SMS delivery and/or an ntfy topic
- An admin dashboard password for local operations
- A TextBee API key and online Android sender device, if TextBee delivery is used

## Local setup

### Automated installation

Run PowerShell as the Windows user who will own the scheduled tasks:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
```

The installer checks Node.js, npm, PowerShell, and Chrome; installs Node dependencies; creates `users.local.json` only when it does not already exist; stores the local admin dashboard password as a user environment variable; and registers the daily planner and dashboard-at-logon tasks.

To install without registering scheduled tasks:

```powershell
.\install.ps1 -SkipTasks
```

The installer never asks for or persists 46elks, TextBee, ntfy, here.now, or Serviceresor credentials. Configure those separately as described below. The existing `users.local.json` is never overwritten. The integrations remain available; only automatic credential persistence is disabled.

### Manual setup

```powershell
npm install
npx skills add heredotnow/skill --skill here-now -g
Copy-Item .\users.example.json .\users.local.json
```

Edit `users.local.json` with Serviceresor credentials and delivery channels. `smsTo` and `textbeeTo` accept E.164 phone numbers, and `ntfyTopics` accepts secret ntfy topic names. Keep this file private. It is ignored by Git.

For SMS delivery, set the 46elks credentials for the Windows user that runs the scheduled task:

```powershell
[Environment]::SetEnvironmentVariable('ELKS_API_USERNAME', 'YOUR_USERNAME', 'User')
[Environment]::SetEnvironmentVariable('ELKS_API_PASSWORD', 'YOUR_PASSWORD', 'User')
```

Set `HERENOW_API_KEY` as a user environment variable or store it in `%USERPROFILE%\.herenow\credentials`.

ntfy defaults to `https://ntfy.sh`. For a self-hosted server or an authenticated topic, set optional user environment variables:

```powershell
[Environment]::SetEnvironmentVariable('NTFY_SERVER_URL', 'https://ntfy.example.com', 'User')
[Environment]::SetEnvironmentVariable('NTFY_ACCESS_TOKEN', 'tk_your_token', 'User')
```

Treat ntfy topics as secrets. Use long random topic names and do not commit them.

TextBee uses `POST /api/v1/gateway/send-sms` with the `x-api-key` header. Configure its API key and optional Android device:

```powershell
[Environment]::SetEnvironmentVariable('TEXTBEE_API_KEY', 'your-textbee-api-key', 'User')
[Environment]::SetEnvironmentVariable('TEXTBEE_DEVICE_ID', 'optional-device-id', 'User')
[Environment]::SetEnvironmentVariable('TEXTBEE_BASE_URL', 'https://api.textbee.dev/api/v1', 'User')
```

The publisher path is machine-specific:

```powershell
[Environment]::SetEnvironmentVariable('HERENOW_PUBLISH_SCRIPT', 'C:\path\to\publish.sh', 'User')
[Environment]::SetEnvironmentVariable('GIT_BASH_PATH', 'C:\Program Files\Git\bin\bash.exe', 'User')
```

## Admin dashboard

Set a local dashboard password and start the console:

```powershell
[Environment]::SetEnvironmentVariable('ADMIN_DASHBOARD_PASSWORD', 'use-a-long-local-password', 'User')
```

Open `http://127.0.0.1:8787` and sign in with username `admin` by default. Run `.\install-admin-task.ps1` once to start it at Windows logon. The dashboard is localhost-only unless `ADMIN_DASHBOARD_HOST` is explicitly changed.

It shows users, delivery channels, today's plan, Windows tasks, active temporary map sessions, environment health, and recent logs. It can also start planning, update user delivery settings, and close all tracking sessions.

The dashboard task runs at Windows logon and listens only on `127.0.0.1:8787` by default. To run it manually:

```powershell
npm run admin
```

## Scheduled tasks

The installer registers:

- `Serviceresor daily planner`: runs at 01:00, reads today's trips, checks bookings one hour before departure, and creates per-trip tracking tasks.
- `Serviceresor admin dashboard`: starts the localhost admin dashboard at Windows logon.
- `Fardtjanst-trip-*`: temporary one-shot status and tracking tasks created by the planner.

Inspect them with:

```powershell
Get-ScheduledTask | Where-Object TaskName -like '*Serviceresor*'
Get-ScheduledTask | Where-Object TaskName -like 'Fardtjanst-trip-*'
```

## Schedule

Run `.\install-scheduled-task.ps1` once from PowerShell. It registers `Serviceresor daily planner` for 01:00. The task must run as the configured Windows user and have access to the user environment variables.

The planner reads all trips under `Idag` and creates two tasks per user and trip. One task checks one hour before departure that the booking still exists; if it has been cancelled, the later tracking task is removed. The tracker starts ten minutes before departure. Tracking ends 90 minutes after departure or when the 60-minute session URL lifetime expires, whichever comes first.

## OpenStreetMap tiles

The live map uses `https://tile.openstreetmap.org/{z}/{x}/{y}.png` for normal interactive viewing only. The map displays clickable OpenStreetMap attribution and a map-issue link. It does not prefetch areas, bulk-download tiles, provide offline maps, or disable browser caching. Tile layers request only the active viewport, update while idle, do not keep a large off-screen buffer, and preserve a normal cross-origin `Referer`. The ongoing-resor gallery uses lazy iframe loading so inactive maps do not all request tiles at once. Browser requests retain their normal identification and referrer behavior. See the [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) before changing the tile provider or adding map features.

## Security

Never commit `users.local.json`, `.herenow/`, logs, screenshots, API keys, or SMS credentials. Rotate any credentials that have been exposed in chat, terminals, or version control.
