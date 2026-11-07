# Serviceresor i Docker

Docker-versionen av färdtjänst. Windows-versionen i repo-roten är orörd och
fortsätter att fungera precis som förut; allt som hör behållaren till ligger här.

## Så här fungerar mappen

- `app/` – kopior av de fungerande appfilerna från repo-roten. Kör
  `node docker/sync-app.js` för att synka in uppdateringar från
  Windows-versionen. `app/admin-server.js` är anpassad för Linux (PowerShell
  ersatt med `scheduler.js`) och skrivs aldrig över av synkningen.
- `scheduler.js` – ersätter Windows Task Scheduler: planeraren körs 01:00,
  check 60 minuter före avgång (exit-kod 10 avbokar spårningen) och spårning
  10 minuter före avgång. Skriver `scheduler-state.json` som panelen läser och
  tar emot kommandon via `scheduler-command.json`.
- `entrypoint.sh` – startar schemaläggaren och adminpanelen tillsammans.
- `chrome-wrapper.sh` – kör Chrome med `--no-sandbox`; `CHROME_PATH` pekar hit
  så att `tracking-service.js` behöver inga ändringar.

## Första gången

1. Skapa datamappen och kopiera konfigurationsmallarna:

   ```sh
   mkdir -p docker/data
   cp users.example.json docker/data/users.local.json
   cp .env.example.json docker/data/.env.local.json
   ```

2. Fyll i `docker/data/users.local.json` (Serviceresor-inloggning,
   SMS/TextBee/ntfy-mottagare) och `docker/data/.env.local.json`
   (`ADMIN_DASHBOARD_PASSWORD` minst 12 tecken, `HERENOW_API_KEY`,
   ev. SMS-nycklar). Får aldrig commitas – de ligger utanför Git via `docker/data/`.

3. Bygg och starta:

   ```sh
   cd docker
   docker compose up -d --build
   ```

4. Öppna adminpanelen på <http://127.0.0.1:8787> (användare `admin`).

Behållaren startar om sig själv vid krasch eller omstart (`restart: unless-stopped`).
Ändrar du appfiler i repo-roten: `node docker/sync-app.js` och sedan
`docker compose up -d --build` för att bygga om.

## Skillnader mot Windows-versionen

| Windows | Docker |
| --- | --- |
| Task Scheduler (`install-scheduled-task.ps1`) | `scheduler.js` (egen process i behållaren) |
| `run-daily-trips.ps1` / `run-track-trip.ps1` / `run-check-trip.ps1` | `scheduler.js` med samma tider och loggnamn |
| `run-hidden.vbs`, mutexfiler | ingen mutex behövs (en process) |
| PowerShell i `admin-server.js` | `scheduler-state.json` + `scheduler-command.json` |
| Loggar i appmappen på disken | loggar i behållarens filsystem, visas i panelen |

Loggfilerna heter som förut (`daily-trips.log`, `trip-<HHMM>.log`,
`trip-<HHMM>-status.log`), och uppgiftsnamnen är oförändrade
(`Serviceresor daily planner`, `Fardtjanst-trip-*`), så panelen fungerar likadant.

## Bild från GitHub (ghcr.io)

Varje push till `master` som ändrar `docker/` bygger bilden automatiskt via
[GitHub Actions](../.github/workflows/docker-image.yml) och publicerar den som
`ghcr.io/kalle42/serviceresor-live-tracking`. Dra den i stället för att bygga:

```sh
docker login ghcr.io -u kalle42 -p <PAT med read:packages>
docker pull ghcr.io/kalle42/serviceresor-live-tracking:latest
```

Bilden innehåller inga hemligheter (`docker/data/` är avstängt i
`.dockerignore`); konfigurationen läggs lokalt i `docker/data/` som vanligt.
Paketet är privat som standard – ändra synlighet under GitHub Settings →
Packages om alla ska kunna dra det.

## Noteringar

- Tidszonen är `Europe/Stockholm` i behållaren – schemaläggningen bygger på
  lokal tid.
- `docker/data/` är den enda platsen med hemligheter. Följ säkerhetsregeln i
  huvud-README: commit:a aldrig `.env.local.json`, `users.local.json` eller
  andra nycklar, och rotera credentials som exponerats.
- Google Chrome installeras i behållaren (amd64). På arm64 (t.ex. Apple
  Silicon) krävs en annan Chrome-källa – ändra då `Dockerfile` och
  `chrome-wrapper.sh`.
- Bygget har verifierats med syntaxkontroll (`node --check`). Själva
  bildbygget kräver att Docker körs på värddatorn.

## Synka om appfilerna

```sh
node docker/sync-app.js
```

Kopierar de oförändrade filerna från repo-roten till `app/` och validerar
syntaxen på all JavaScript. Endast `admin-server.js` lämnas orörd när kopian
redan finns.
