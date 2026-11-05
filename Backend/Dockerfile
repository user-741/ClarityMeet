FROM node:20-slim

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
      chromium xvfb ffmpeg dbus \
      # PulseAudio for virtual audio sink capture
      pulseaudio pulseaudio-utils \
      fonts-liberation libfontconfig1 \
      libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 \
      libgtk-3-0 libnss3 libxcomposite1 libxdamage1 libxfixes3 \
      libxkbcommon0 libxrandr2 libxss1 libxtst6 ca-certificates \
      # VNC - x11vnc mirrors Xvfb, novnc provides browser-based viewer
      x11vnc novnc python3 \
    && rm -rf /var/lib/apt/lists/*

# puppeteer v22+ uses PUPPETEER_SKIP_DOWNLOAD (v21 used PUPPETEER_SKIP_CHROMIUM_DOWNLOAD)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV DISPLAY=:99
ENV NODE_ENV=production

# PulseAudio config: run in system mode so root can use it in container
# This lets Chrome output audio to PA, and ffmpeg read the monitor source
COPY pulseaudio.conf /etc/pulse/default.pa

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p recordings
# Create /data as fallback if Fly volume isn't mounted (e.g. local Docker)
RUN mkdir -p /data/recordings /data/zoom-persistent-profile

EXPOSE 3000

# Start order:
# 1. Xvfb - virtual display for headless Chrome
# 2. x11vnc - VNC server mirroring Xvfb display (localhost:5900, no auth needed internally)
# 3. websockify - bridges WebSocket -> VNC TCP, serves noVNC static files (localhost:6080)
# 4. pulseaudio - virtual audio daemon
# 5. node server.js - main app
CMD ["sh", "-c", "\
  Xvfb :99 -screen 0 1280x720x24 -ac & \
  sleep 1 && \
  x11vnc -display :99 -forever -nopw -shared -rfbport 5900 -bg -o /tmp/x11vnc.log && \
  websockify --web=/usr/share/novnc 6080 localhost:5900 & \
  pulseaudio --start --exit-idle-time=-1 --daemonize=true --system=false && \
  pactl load-module module-null-sink sink_name=ClarityMeet sink_properties=device.description=ClarityMeet 2>/dev/null || true && \
  exec node /app/server.js \
"]
