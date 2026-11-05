#!/bin/sh

echo "==> Starting Xvfb..."
Xvfb :99 -screen 0 1280x720x24 -ac &
export DISPLAY=:99

echo "==> Starting server..."
exec node /app/server.js
