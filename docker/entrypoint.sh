#!/bin/bash
# Startar Serviceresor i behållaren: schemaläggaren och adminpanelen.
# Om någon av dem dör avslutas behållaren så att Docker startar om båda.
set -u

cd /app
mkdir -p /app/data/session-runtime

# Konfigurationen lever i /app/data (volymen) och länkas in i appmappen, så att
# färsk behållare byter kod utan att tappa hemligheter.
if [ ! -f /app/data/users.local.json ]; then
    cp /app/users.example.json /app/data/users.local.json
    echo "VARNING: /app/data/users.local.json saknades – kopia av exemplet skapades. Fyll i riktiga uppgifter."
fi
if [ ! -f /app/data/.env.local.json ]; then
    cp /app/.env.example.json /app/data/.env.local.json
    echo "VARNING: /app/data/.env.local.json saknades – kopia av exemplet skapades. Sätt ADMIN_DASHBOARD_PASSWORD."
fi
ln -sfn /app/data/users.local.json /app/users.local.json
ln -sfn /app/data/.env.local.json /app/.env.local.json
ln -sfn /app/data/session-runtime /app/session-runtime

node /app/scheduler.js &
scheduler_pid=$!
node /app/admin-server.js &
admin_pid=$!

term() {
    kill -TERM "$scheduler_pid" "$admin_pid" 2>/dev/null || true
}
trap term TERM INT

wait -n "$scheduler_pid" "$admin_pid"
term
echo "En process avslutades – behållaren startas om."
exit 1
