# ---- Build ----
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=5000 TZ=Europe/Vienna
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg \
       | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null \
  && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list \
       | tee /etc/apt/sources.list.d/tailscale.list \
  && apt-get update && apt-get install -y --no-install-recommends tailscale \
  && rm -rf /var/lib/apt/lists/*

# Python + edge-tts: Microsoft-Neural-Stimmen für die Sprachausgabe (läuft lokal im selben Container)
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/tts-venv \
  && /opt/tts-venv/bin/pip install --no-cache-dir edge-tts

# Hotword-Erkennung: openWakeWord-Frontend (ONNX) + numpy. Optional: scheitert die Installation, läuft die App trotzdem.
RUN ( python3 -m venv /opt/wake-venv \
  && /opt/wake-venv/bin/pip install --no-cache-dir numpy onnxruntime tqdm requests \
  && /opt/wake-venv/bin/pip install --no-cache-dir --no-deps openwakeword \
  && mkdir -p /opt/wake/models \
  && curl -fsSL -o /opt/wake/models/melspectrogram.onnx https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx \
  && curl -fsSL -o /opt/wake/models/embedding_model.onnx https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx \
  ) || echo "WARNUNG: Hotword-Dienst konnte nicht installiert werden"

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server/tts /app/tts
COPY server/wake /app/wake
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 5000
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://localhost:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
