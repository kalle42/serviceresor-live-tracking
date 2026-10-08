# Serviceresor Live Tracking

Windows-app som l├ñser dagens Serviceresor, kontrollerar avbokningar och skapar krypterade livekartor. Kartl├ñnken kan skickas via 46elks, TextBee och/eller ntfy. Kartan st├ñngs efter 60 minuter.

## Krav

- Windows 10 eller senare
- Git f├╢r Windows och Git Bash
- Node.js LTS
- .NET 8 SDK
- Google Chrome
- `jq`

## Installera med exe-guiden

Bygg guiden:

```powershell
dotnet publish .\installer\ServiceresorInstaller.csproj -c Release -r win-x64 --self-contained true
```

K├╢r den fr├Ñn projektmappen:

```powershell
.\installer\bin\Release\net8.0\win-x64\publish\ServiceresorInstaller.exe
```

Guiden kontrollerar kraven, fr├Ñgar efter lokalt adminl├╢senord och lokala v├ñrden f├╢r here.now, 46elks, TextBee och ntfy. Hemliga v├ñrden maskeras och sparas i `.env.local.json`, som ignoreras av Git. Valfria integrationer kan l├ñmnas tomma.

Git Bash hittas automatiskt fr├Ñn Git f├╢r Windows. `publish.sh` hittas automatiskt i vanliga skill-mappar. Om den saknas installerar guiden here.now-skillen med `npx` och f├╢rs├╢ker igen. Manuell s├╢kv├ñg efterfr├Ñgas endast om automatiken misslyckas.

Serviceresor-anv├ñndarnas personnummer och l├╢senord lagras separat i `users.local.json`.

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

K├╢r `setup-app.ps1 -SkipTasks` om schemalagda uppgifter inte ska registreras.

## Lokal konfiguration

```powershell
Copy-Item .\users.example.json .\users.local.json
Copy-Item .\.env.example.json .\.env.local.json
```

Fyll i Serviceresor-uppgifter och mottagare i `users.local.json`. Fyll i de integrationer som anv├ñnds i `.env.local.json`. Tracker- och adminprocesserna l├ñser filerna automatiskt. V├ñrdena kopieras inte till Windows anv├ñndarmilj├╢.

## Adminpanel och tray

Starta adminpanelen manuellt:

```powershell
npm run admin
```

├ûppna `http://127.0.0.1:8787` och logga in som `admin`.

Tray-appen installeras i `%LOCALAPPDATA%\Serviceresor` och startar via anv├ñndarens Startup-mapp. Dubbelklick ├╢ppnar adminpanelen. H├╢gerklick visar ├╢ppna, starta om och avsluta.

Manuell tray-installation:

```powershell
dotnet publish .\tray\ServiceresorTray.csproj -c Release -r win-x64 --self-contained true --artifacts-path "$env:TEMP\ServiceresorTrayArtifacts" -o "$env:LOCALAPPDATA\Serviceresor"
.\setup-tray-app.ps1
```

## Automatik

Planeraren k├╢rs klockan `01:00` och:

- L├ñser resor under `Idag`.
- Kontrollerar avbokning en timme f├╢re avg├Ñng.
- Startar tracking tio minuter f├╢re avg├Ñng.
- Kontrollerar fordonsnummer l├╢pande.
- Skickar kartl├ñnken via konfigurerade kanaler.
- Avslutar kartan efter 60 minuter.

## Tester

```powershell
npm install
npm run check
npm audit
```

## S├ñkerhet

Commit:a aldrig `.env.local.json`, `users.local.json`, `.herenow`, `session-runtime`, loggar, screenshots eller API-nycklar. Rotera credentials som har exponerats i chat eller Git.

Kartorna anv├ñnder OpenStreetMap med synlig attribution, normalt browser-cachebeteende, ingen tile-prefetch och ingen offline-nedladdning. Se [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) innan kartlagret ├ñndras.
