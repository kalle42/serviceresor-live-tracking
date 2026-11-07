# Serviceresor Live Tracking

Läser dagens Serviceresor, kontrollerar avbokningar och skapar krypterade livekartor över resorna. Kartlänken skickas via 46elks, TextBee och/eller ntfy och kartan stängs efter 60 minuter. Kartvisaren är en Leaflet-karta med OpenStreetMap som publiceras till here.now.

## Två sätt att köra

|  | Windows | Docker |
| --- | --- | --- |
| Installation | exe-guide eller `setup-app.ps1` | `docker compose up -d` |
| Schemaläggning | Windows Task Scheduler | `scheduler.js` i behållaren |
| Adminpanel | <http://127.0.0.1:8787> | <http://127.0.0.1:8787> |
| Detaljer | nedan | [docker/README.md](docker/README.md) |

Windows-versionen i roten är originalen. Docker-versionen i [docker/](docker/) använder kopior av samma fungerande filer, så båda kan leva sida vid sida.

## Krav (Windows)

- Windows 10 eller senare
- Git för Windows och Git Bash
- Node.js LTS
- .NET 8 SDK
- Google Chrome
- `jq`

## Installera på Windows

### Med exe-guiden

Bygg guiden:

```powershell
dotnet publish .\installer\ServiceresorInstaller.csproj -c Release -r win-x64 --self-contained true
```

Kör den från projektmappen:

```powershell
.\installer\bin\Release\net8.0\win-x64\publish\ServiceresorInstaller.exe
```

Guiden kontrollerar kraven, frågar efter lokalt adminlösenord och lokala värden för here.now, 46elks, TextBee och ntfy. Hemliga värden maskeras och sparas i `.env.local.json`, som ignoreras av Git. Valfria integrationer kan lämnas tomma.

Git Bash hittas automatiskt från Git för Windows. `publish.sh` hittas automatiskt i vanliga skill-mappar. Om den saknas installerar guiden here.now-skillen med `npx` och försöker igen. Manuell sökväg efterfrågas endast om automatiken misslyckas.

Serviceresor-användarnas personnummer och lösenord lagras separat i `users.local.json`.

### Snabb deploy

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

### Lokal konfiguration

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

Öppna `http://127.0.0.1:8787` och logga in som `admin`. Översikten visar dagens plan, schemalagda uppgifter och aktiva kartor. Menyn i toppen har egna sidor för `Användare & leverans` och `API & nycklar` (nycklar och testknappar för SMS/ntfy-kanalerna).

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

## Docker

Se [docker/README.md](docker/README.md) för bygge, körning och ghcr-bilden. Kort sagt: fyll i `docker/data/`, kör `docker compose up -d`, öppna adminpanelen. `node docker/sync-app.js` håller Docker-kopiorna uppdaterade med Windows-filerna.

## Tester

```powershell
npm install
npm run check
npm audit
```

## Säkerhet

Commit:a aldrig `.env.local.json`, `users.local.json`, `.herenow`, `session-runtime`, loggar, screenshots eller API-nycklar. Rotera credentials som har exponerats i chat eller Git.

Kartorna använder OpenStreetMap med synlig attribution, normalt browser-cachebeteende, ingen tile-prefetch och ingen offline-nedladdning. Se [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) innan kartlagret ändras.
