# Serviceresor Live Tracking

Läser dagens Serviceresor, kontrollerar avbokningar och skapar krypterade livekartor över resorna. Kartlänken skickas via 46elks, TextBee och/eller ntfy och kartan stängs efter 60 minuter. Kartvisaren är en Leaflet-karta med OpenStreetMap som publiceras till here.now.

## Så fungerar skriptet

Hjärtat i systemet är `tracking-service.js`. Det körs i tre lägen – planering (standard), `check` (avbokningskontroll) och `track` (spårning av en resa) – och omges av PowerShell-skript som schemalägger körningarna i Windows Task Scheduler.

### Delarna

| Fil | Uppgift |
| --- | --- |
| `tracking-service.js` | Huvudskriptet. Tre lägen: planering (standard), `check` och `track`. |
| `local-env.js` | Läser `.env.local.json` och hittar Chrome, Git Bash och `publish.sh` åt skriptet. |
| `run-daily-trips.ps1` | Startar planeringen och registrerar en schemalagd uppgift per resa. |
| `run-track-trip.ps1` | Startar spårningen av en enskild resa (mut­ex per resetid, ingen dubbelkörning). |
| `run-check-trip.ps1` | Kör avbokningskontrollen och tar bort spårningsuppgiften om resan är borttagen. |
| `run-hidden.vbs` | Kör kommandona utan synligt konsolfönster. |
| `session-map/` | Kartvyn (Leaflet + OpenStreetMap) som publiceras till here.now. |
| `session-runtime/` | JSON-filer med metadata om aktiva kartsessioner (visas i adminpanelen). |
| `admin-server.js`, `admin-dashboard/` | Adminpanelen på `http://127.0.0.1:8787`. |
| `users.local.json` | Användare: personnummer, lösenord och mottagare för SMS/ntfy. |
| `.env.local.json` | API-nycklar och inställningar (se `.env.example.json`). |
| `tools/sha256sum` | Adapter som `publish.sh` behöver vid körning i Git Bash. |

### Flödet över ett dygn

```
01:00  run-daily-trips.ps1        planering: läser dagens resor → todays-trips.json
  │                                och registrerar två uppgifter per resa
  ├─ −60 min  run-check-trip.ps1   avbokad? → ta bort spårningsuppgiften
  └─ −10 min  run-track-trip.ps1   spårning: publicerar karta, skickar länk,
                                   följer bilen och stänger kartan efter 60 min
```

### 1. Daglig planering (kl. 01:00)

`run-daily-trips.ps1` (schemalagt som *Serviceresor daily planner*, se `install-scheduled-task.ps1`) tar en mutex (`FardtjanstDailyTrips`) och kör `node tracking-service.js`:

1. För varje användare i `users.local.json` startas Chrome huvudlöst via Puppeteer (`puppeteer-core`), loggar in på `https://minaserviceresor.goteborg.se` och går till `/resor`.
2. Sidan fälls ut med *Visa fler resor* och skriptet läser alla bokningslänkar (`/resor/bokning/…`) som ligger under rubriken **Idag** – inte längre fram på sidan. Tiderna tolkas till minuter från midnatt och dubbletter tas bort.
3. Resultatet skrivs till `todays-trips.json` i formen `{ date, users: [{ userId, trips: [{ url, time, minutes }] }] }`.

Därefter tar skriptet bort gamla `Fardtjanst-trip-*`-uppgifter och registrerar två nya uppgifter per resa:

- **Avbokningskontroll** 60 minuter före avgång (om tidpunkten ännu inte passerat).
- **Spårning** 10 minuter före avgång.

Båda körs dolt via `run-hidden.vbs`, med `StartWhenAvailable` och `WakeToRun`, så de kör även om datorn just har legat i viloläge.

### 2. Avbokningskontroll (`check`-läget)

En timme före avgång kör `run-check-trip.ps1`:

```
node tracking-service.js check <userId> <url> <time>
```

Skriptet läser om dagens resor för användaren. Om resans URL inte längre finns med behandlas resan som avbokad och skriptet avslutar med kod **10** – då tar wrapper-skriptet bort den schemalagda spårningsuppgiften, så ingen onödig karta skapas. Kontrollen loggas till `trip-HHMM-status.log`.

### 3. Spårning (`track`-läget)

Tio minuter före avgång kör `run-track-trip.ps1` (mut­ex `FardtjanstTripHHMM`):

```
node tracking-service.js track <userId> <url> <time> <minutes>
```

`trackTrip()` i `tracking-service.js` gör då följande:

1. **Sessionskarta publiceras.** `publish.sh` (here.now-skillen, körs i Git Bash) publicerar katalogen `session-map/` med `--ttl 3600`. Först skrivs ett Site Data-manifest (`session-map/.herenow/data.json`) om det saknas – utan det får varje positionsskrivning `404 collection_disabled` och kartan blir tom. Skriptet väntar (upp till 30 s) tills datakollektionen `positions` svarar, så mottagaren aldrig får en karta utan data.
2. **Krypteringsnyckel skapas.** 32 slumpmässiga byte (AES-256-GCM). Länken blir `<sajt-url>#<base64url-nyckel>` – nyckeln ligger bara i URL:ens fragment och skickas aldrig till servern.
3. **Sessionen registreras** i `session-runtime/<slug>.json` med länk, resetid och utgångstid.
4. **Inloggning med reservationer.** Skriptet loggar in (upp till 3 försök) och öppnar resans sida. Resans uppgifter läses och publiceras *innan* länken skickas, så kartan inte är tom när den öppnas.
5. **Länken skickas** via alla konfigurerade kanaler parallellt – SMS via 46elks (`from: Serviceresa`, `dontlog: message`), SMS via TextBee och/eller ntfy-notis. Minst en kanal måste lyckas, annars kastas ett fel.

Sedan följer spårningsloopen, fram till dess att länkens 60-minuters livstid tar slut (eller 90 minuter efter avgång – det som inträffar först):

- **Tre datakällor** fångar resan:
  - Nätverkssvaren från plattformen fångas direkt (`page.on('response')`): `/v2/d/trips/<id>` ger hämt- och lämningsadress, koordinater och resenärens förnamn; `/v2/trips/vehicleinfo/<externalId>` ger fordonsnumret när det tilldelats strax före avgång.
  - Sidans EventSource-ström (bilens GPS) kapslas in och varje position vidarebefordras till `publishDailyVehiclePosition`.
  - Var 30:e sekund läses rese-API:t om (`/d/trips/<id>` + `/trips/vehicleinfo/…`) som reserv.
- **Varje uppdatering krypteras** med AES-256-GCM (slumpmässig IV, auth tag följer med chiffertexten) och POST/PATCH:as till here.now-kollektionen `positions`. Skrivningar köas så de inte krockar, med tre försök per skrivning. Positionen upprepas som hjärtslag var 30:e sekund.
- **Om sajten försvinner** (404 på skrivning) roteras sessionen en gång: en ny karta publiceras och en ny länk skickas – men inte om mindre än 5 minuter återstår av länkens livstid. `404 collection_disabled` roteras aldrig; det betyder att manifestet saknas.
- **När tiden är slut** stängs webbläsaren, sajten tas bort (`DELETE /api/v1/publish/<slug>`) och sessionen avregistreras.

### 4. Kartvyn (`session-map/`)

En statisk Leaflet-karta med OpenStreetMap-brickor. Nyckeln läses från URL:ens fragment och används i WebCrypto (`AES-GCM`) för att dekryptera posten i `./.herenow/data/positions?limit=1`. Kartan visar resenärens förnamn, fordonsnummer, hämt- och lämningsadress samt bilens position i realtid. Länken slutar fungera när here.now-sajtens TTL (60 minuter) löper ut, och sajten raderas dessutom av spårningen.

### Säkerhet

- Positionsdatan är end-to-end-krypterad: here.now lagrar bara chiffertext och IV. Nyckeln finns bara i kartlänkens fragment.
- 46elks-meddelanden skickas med `dontlog: message` så att SMS-innehållet inte loggas.
- API-nycklar läses från `.env.local.json` eller miljövariabler. here.now-nyckeln kan också ligga i `~/.herenow/credentials`.
- `session-runtime/` innehåller bara metadata – aldrig krypteringsnyckeln.

## Konfiguration

- **`users.local.json`** – en lista med användare: `id`, `ssn`, `password`, `smsTo`, `textbeeTo`, `ntfyTopics` (se `users.example.json`). Fälten kan vara en sträng eller en array.
- **`.env.local.json`** – API-uppgifter enligt `.env.example.json`: `HERENOW_API_KEY`, `ELKS_API_USERNAME`/`ELKS_API_PASSWORD`, `TEXTBEE_API_KEY`/`TEXTBEE_DEVICE_ID`/`TEXTBEE_BASE_URL`, `NTFY_SERVER_URL`/`NTFY_ACCESS_TOKEN` samt `ADMIN_DASHBOARD_*`.
- **Valfria miljövariabler:** `CHROME_PATH`, `GIT_BASH_PATH` och `HERENOW_PUBLISH_SCRIPT` – annars letar `local-env.js` upp Chrome, Git Bash och `publish.sh` automatiskt. `HEADLESS_BROWSER=0` visar webbläsaren när en resa felsöks för hand.

## Loggar

| Fil | Innehåll |
| --- | --- |
| `daily-trips.log`, `daily-trips-error.log` | Den dagliga planeringen. |
| `trip-HHMM.log`, `trip-HHMM-error.log` | Spårningen av resan med avgång HH:MM. |
| `trip-HHMM-status.log` | Avbokningskontrollen. |

## Körning för hand

```bash
npm run plan     # läser dagens resor och skriver todays-trips.json
npm run check    # syntaxkontroll av alla JS-filer
npm run admin    # startar adminpanelen
```

En enskild spårning startas via `run-track-trip.ps1`, eller direkt:
`node tracking-service.js track <userId> <url> <time> <minutes>`.

## Installera på Windows

Ladda ner och kör `ServiceresorSetup.exe`. Installationsprogrammet lägger appen på plats, registrerar schemalagda uppgifter och skapar genvägar.

Öppna `http://127.0.0.1:8787` och logga in som `admin`. Översikten visar dagens plan, schemalagda uppgifter och aktiva kartor. Menyn i toppen har egna sidor för `Användare & leverans` och `API & nycklar` (nycklar och testknappar för SMS/ntfy-kanalerna).

## Docker


