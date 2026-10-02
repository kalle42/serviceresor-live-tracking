# Serviceresor Live Tracking

App för Windows och Linux som läser dagens Serviceresor, kontrollerar avbokningar och skapar krypterade livekartor. Kartlänken kan skickas via 46elks, TextBee och/eller ntfy. Kartan stängs efter 60 minuter.

## Windows-krav

- Windows 10 eller senare
- Git för Windows
- Node.js LTS
- .NET 8 SDK
- Google Chrome

## Installera med exe-guiden

Bygg guiden:

```powershell
dotnet publish .\installer\ServiceresorInstaller.csproj -c Release -r win-x64 --self-contained true
```

Kör den från projektmappen:

```powershell
.\installer\bin\Release\net8.0\win-x64\publish\ServiceresorInstaller.exe
```

Guiden kontrollerar kraven, frågar efter lokalt adminlösenord och lokala värden för here.now, 46elks, TextBee och ntfy. Hemliga värden maskeras och sparas i `.env.local.json`, som ignoreras av Git. Valfria integrationer kan lämnas tomma.

Serviceresor-användarnas personnummer och lösenord lagras separat i `users.local.json`.

## Snabb deploy

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/kalle42/serviceresor-live-tracking/development/deploy-app.ps1).Content))
```

I en befintlig mapp:

```powershell
git pull --ff-only origin development
.\setup-app.ps1
```

Kör `setup-app.ps1 -SkipTasks` om schemalagda uppgifter inte ska registreras.

## Linux med Docker

Docker-versionen innehåller Chromium och en Linux-daemon som ersätter Windows Task Scheduler. Docker Engine med Compose-plugin krävs.

```bash
git clone --branch development https://github.com/kalle42/serviceresor-live-tracking.git
cd serviceresor-live-tracking
cp users.example.json users.local.json
cp .env.docker.example .env.docker
```

Fyll i riktiga Serviceresor-uppgifter och mottagare i `users.local.json`. Sätt ett adminlösenord med minst 12 tecken och en here.now API-nyckel i `.env.docker`. 46elks, TextBee och ntfy är valfria.

Validera konfigurationen och starta sedan containern:

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs -f
```

När `docker compose ps` visar `healthy` finns adminpanelen på `http://127.0.0.1:8787`. Logga in som `admin` med lösenordet från `.env.docker`. Porten binds bara till värddatorns localhost.

Starta om efter konfigurationsändringar och stoppa tjänsten med:

```bash
docker compose up -d --force-recreate
docker compose down
```

Planer, sessioner och processregister sparas i Docker-volymen `serviceresor-data`. `users.local.json` monteras från projektmappen så att användare kan redigeras i adminpanelen. `.env.docker` och användarfilen byggs inte in i imagen och ignoreras av Git.

Vid felsökning:

```bash
docker compose logs --tail 200 serviceresor
docker compose restart serviceresor
```

`docker compose down -v` tar även bort sparade planer och sessionsdata.

## Linux utan Docker

Installera Node.js, Chromium och npm-paketen. Sätt minst `CHROME_EXECUTABLE`, `TRACKER_HEADLESS=true`, `DATA_DIR`, `USERS_FILE`, `ADMIN_DASHBOARD_PASSWORD` och `HERENOW_API_KEY`. Starta sedan:

```bash
npm ci
npm run linux
```

Starta adminservern separat med `npm run admin`.

## Lokal konfiguration

```powershell
Copy-Item .\users.example.json .\users.local.json
Copy-Item .\.env.example.json .\.env.local.json
```

Fyll i Serviceresor-uppgifter och mottagare i `users.local.json`. Fyll i de integrationer som används i `.env.local.json`. Tracker- och adminprocesserna läser filerna automatiskt. Värdena kopieras inte till Windows användarmiljö.

## Adminpanel och tray

Starta adminpanelen manuellt:

```powershell
npm run admin
```

Öppna `http://127.0.0.1:8787` och logga in som `admin`.

Tray-appen installeras i `%LOCALAPPDATA%\Serviceresor` och startar via användarens Startup-mapp. Dubbelklick öppnar adminpanelen. Högerklick visar öppna, starta om och avsluta.

Manuell tray-installation:

```powershell
dotnet publish .\tray\ServiceresorTray.csproj -c Release -r win-x64 --self-contained true --artifacts-path "$env:TEMP\ServiceresorTrayArtifacts" -o "$env:LOCALAPPDATA\Serviceresor"
.\setup-tray-app.ps1
```

## Automatik

Planeraren körs klockan `01:00` och:

- Läser resor under `Idag`.
- Kontrollerar avbokning en timme före avgång.
- Startar tracking tio minuter före avgång.
- Kontrollerar fordonsnummer löpande.
- Skickar kartlänken via konfigurerade kanaler.
- Avslutar kartan efter 60 minuter.

## Tester

```powershell
npm install
npm run check
npm audit
```

## Säkerhet

Commit:a aldrig `.env.local.json`, `.env.docker`, `users.local.json`, `.herenow`, `session-runtime`, loggar, screenshots eller API-nycklar. Rotera credentials som har exponerats i chat eller Git.

Kartorna använder OpenStreetMap med synlig attribution, normalt browser-cachebeteende, ingen tile-prefetch och ingen offline-nedladdning. Se [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) innan kartlagret ändras.
