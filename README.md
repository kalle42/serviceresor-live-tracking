# Serviceresor Live Tracking

Windows-app som läser dagens Serviceresor, kontrollerar avbokningar och startar krypterade livekartor före varje resa. Kartlänken kan skickas via SMS, TextBee och/eller ntfy. Tillfälliga kartor raderas efter 60 minuter.

## Snabb installation

Kräver Windows, Git, Node.js LTS, Google Chrome, Git Bash och `jq`.

Bygg den interaktiva Windows-guiden:

```powershell
dotnet publish .\installer\ServiceresorInstaller.csproj -c Release -r win-x64 --self-contained true
```

Starta sedan:

```powershell
.\installer\bin\Release\net8.0\win-x64\publish\ServiceresorInstaller.exe
```

Guiden kontrollerar Node.js, npm, Git och Chrome, frågar efter adminlösenordet utan att visa tecknen och kör den befintliga PowerShell-installern. Den frågar aldrig efter eller sparar Serviceresor-, SMS-, TextBee-, ntfy- eller here.now-uppgifter.

Installern bygger även en tray-app. Den visas i Windows systemfält och öppnar adminpanelen med dubbelklick eller högerklicksmenyn. Tray-appen registreras i den aktuella användarens Windows-autostart och kräver inte administratörsrättigheter.

Alternativt kan installationen köras direkt:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& ([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/kalle42/serviceresor-live-tracking/development/deploy.ps1).Content))
```

Detta klonar eller uppdaterar `development`, installerar beroenden och registrerar Windows-uppgifterna. Lokala filer som `users.local.json` skrivs inte över.

För en redan klonad mapp:

```powershell
git pull --ff-only origin development
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1
```

Använd `.\setup.ps1 -SkipTasks` om du vill installera utan att registrera schemalagda uppgifter.

## Lokal konfiguration

Skapa användarkonfigurationen:

```powershell
Copy-Item .\users.example.json .\users.local.json
```

Fyll i `users.local.json` med Serviceresor-uppgifter och mottagare. Filen är lokal och ignoreras av Git.

Konfigurera adminlösenordet:

```powershell
[Environment]::SetEnvironmentVariable('ADMIN_DASHBOARD_PASSWORD', 'ditt-lokala-lösenord', 'User')
```

Konfigurera de tjänster som ska användas separat. Installern sparar inte dessa värden automatiskt:

```powershell
[Environment]::SetEnvironmentVariable('HERENOW_API_KEY', 'din-nyckel', 'User')
[Environment]::SetEnvironmentVariable('HERENOW_PUBLISH_SCRIPT', 'C:\sökväg\till\publish.sh', 'User')
[Environment]::SetEnvironmentVariable('GIT_BASH_PATH', 'C:\Program Files\Git\bin\bash.exe', 'User')

[Environment]::SetEnvironmentVariable('ELKS_API_USERNAME', 'ditt-användarnamn', 'User')
[Environment]::SetEnvironmentVariable('ELKS_API_PASSWORD', 'ditt-lösenord', 'User')

[Environment]::SetEnvironmentVariable('TEXTBEE_API_KEY', 'din-api-nyckel', 'User')
[Environment]::SetEnvironmentVariable('TEXTBEE_DEVICE_ID', 'valfritt-enhets-id', 'User')

[Environment]::SetEnvironmentVariable('NTFY_SERVER_URL', 'https://ntfy.sh', 'User')
[Environment]::SetEnvironmentVariable('NTFY_ACCESS_TOKEN', 'valfri-token', 'User')
```

Starta om PowerShell eller logga ut/in efter att användarvariabler ändrats.

## Adminpanel

Starta manuellt:

```powershell
npm run admin
```

Öppna `http://127.0.0.1:8787` och logga in som `admin`. Panelen visar dagens resor, aktiva resor, sessionsstatus, Windows-uppgifter, leveranskanaler och loggar. Den kan även starta planering, ändra användare och stänga aktiva sessioner.

Installern kan starta panelen automatiskt vid Windows-inloggning:

```powershell
.\install-admin-task.ps1
```

Tray-ikonen installeras automatiskt av `setup.ps1`. Manuell installation:

```powershell
dotnet publish .\tray\ServiceresorTray.csproj -c Release -r win-x64 --self-contained true
.\setup-tray.ps1
```

## Automatik

`Serviceresor daily planner` körs varje dag klockan `01:00` och:

- Läser resor under `Idag`.
- Kontrollerar varje resa en timme före avgång.
- Tar bort tracking-uppgiften om resan har försvunnit eller avbokats.
- Loggar in och startar tracking tio minuter före avgång.
- Kontrollerar fordonsnummer löpande tills det hittas.
- Skickar kartlänken via konfigurerade kanaler.
- Avslutar kartan efter 60 minuter.

## Tester

```powershell
npm install
npm run check
npm audit
```

## Säkerhet

Commit:a aldrig `users.local.json`, `.herenow`, `session-runtime`, loggar, screenshots, API-nycklar, SMS-lösenord eller ntfy-topics. Kör endast adminpanelen lokalt om du inte uttryckligen behöver exponera den. Rotera alla credentials som har exponerats i chat eller Git.

Kartorna använder OpenStreetMap med synlig attribution, normalt browser-cachebeteende, ingen tile-prefetch och ingen offline-nedladdning. Se [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) innan kartlagret ändras.
