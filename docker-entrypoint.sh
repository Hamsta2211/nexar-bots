#!/bin/sh
set -e

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
