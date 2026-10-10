#!/bin/sh
set -e

# Microsoft-TTS (Python, edge-tts) lokal starten. Vor Tailscale, damit der Dienst keine Proxy-Variablen erbt.
# Die Schleife startet ihn neu, falls er abstürzt.
if [ -x /opt/tts-venv/bin/python ] && [ -f /app/tts/tts_server.py ]; then
  (
    while true; do
      env -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
        /opt/tts-venv/bin/python /app/tts/tts_server.py >>/tmp/tts.log 2>&1 || true
      sleep 2
    done
  ) &
  echo "[entrypoint] TTS-Dienst (edge-tts) gestartet"
fi

# Hotword-Dienst (openWakeWord-Merkmale + Namensmodelle), lädt Modelle erst bei Bedarf und gibt sie im Leerlauf wieder frei
if [ -x /opt/wake-venv/bin/python ] && [ -f /app/wake/wake_server.py ] && [ -f /opt/wake/models/embedding_model.onnx ]; then
  (
    while true; do
      env -u ALL_PROXY -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
        /opt/wake-venv/bin/python /app/wake/wake_server.py >>/tmp/wake.log 2>&1 || true
      sleep 3
    done
  ) &
  echo "[entrypoint] Hotword-Dienst gestartet"
fi

# Start Tailscale in userspace mode if auth key is present
if [ -n "$TAILSCALE_AUTHKEY" ]; then
  echo "[entrypoint] Starting Tailscale (userspace)..."
  mkdir -p /var/lib/tailscale /var/run/tailscale
  tailscaled \
    --tun=userspace-networking \
    --socks5-server=localhost:1055 \
    --state=/var/lib/tailscale/tailscaled.state \
    --socket=/var/run/tailscale/tailscaled.sock \
    >/tmp/tailscaled.log 2>&1 &

  # Wait until tailscaled is ready
  i=0
  while [ $i -lt 30 ]; do
    if tailscale --socket=/var/run/tailscale/tailscaled.sock status >/dev/null 2>&1; then
      break
    fi
    i=$((i + 1))
    sleep 0.5
  done

  tailscale --socket=/var/run/tailscale/tailscaled.sock up \
    --authkey="$TAILSCALE_AUTHKEY" \
    --hostname="${TAILSCALE_HOSTNAME:-nexar-bots}" \
    --accept-dns=true \
    || echo "[entrypoint] Warning: tailscale up failed (check logs)"

  # Route Node outbound (incl. SSH) through Tailscale SOCKS proxy
  export ALL_PROXY="socks5h://127.0.0.1:1055"
  export HTTP_PROXY="http://127.0.0.1:1055"
  export HTTPS_PROXY="http://127.0.0.1:1055"
  echo "[entrypoint] Tailscale up; ALL_PROXY set for app"
else
  echo "[entrypoint] No TAILSCALE_AUTHKEY – skipping Tailscale"
fi

exec node dist/index.cjs
