# Serviceresor Live Tracking

Läser dagens Serviceresor, kontrollerar avbokningar och skapar krypterade livekartor över resorna. Kartlänken skickas via 46elks, TextBee och/eller ntfy och kartan stängs efter 60 minuter. Kartvisaren är en Leaflet-karta med OpenStreetMap som publiceras till here.now.

Docker
docker run -d --name fardtjanst --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v /path/till/docker/data:/app/data \
  -e TZ=Europe/Stockholm \
  -e ADMIN_DASHBOARD_HOST=0.0.0.0 \
  -e ADMIN_DASHBOARD_PORT=8787 \
  -e ADMIN_DASHBOARD_USER=admin \
  -e ADMIN_DASHBOARD_PASSWORD="minst-12-tecken" \
  -e HERENOW_API_KEY="..." \
  -e ELKS_API_USERNAME="..." \
  -e ELKS_API_PASSWORD="..." \
  -e TEXTBEE_API_KEY="..." \
  -e TEXTBEE_DEVICE_ID="..." \
  -e TEXTBEE_BASE_URL="https://api.textbee.dev/api/v1" \
  -e NTFY_SERVER_URL="https://ntfy.sh" \
  -e NTFY_ACCESS_TOKEN="..." \
  ghcr.io/kalle42/serviceresor-live-tracking:latest

Installera på Windows
Ladda ner och kör ServiceresorSetup.exe

Öppna `http://127.0.0.1:8787` och logga in som `admin`. Översikten visar dagens plan, schemalagda uppgifter och aktiva kartor. Menyn i toppen har egna sidor för `Användare & leverans` och `API & nycklar` (nycklar och testknappar för SMS/ntfy-kanalerna).


## Automatik

Planeraren körs klockan `01:00` och:

- Läser resor under `Idag`.
- Kontrollerar avbokning en timme före avgång.
- Startar tracking tio minuter före avgång.
- Kontrollerar fordonsnummer löpande.
- Skickar kartlänken via konfigurerade kanaler.
- Avslutar kartan efter 60 minuter.

