#!/bin/sh
# Chrome utan sandlåda för behållare: tracking-service.js ligger orörd och
# CHROME_PATH pekar hit, så slipper appfilerna veta något om Docker.
exec /usr/bin/google-chrome-stable --no-sandbox --disable-dev-shm-usage "$@"
