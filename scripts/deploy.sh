#!/usr/bin/env sh
# One-command deploy on a Linux server with Docker installed.
#   sh scripts/deploy.sh            -> HTTP on port 3000 (or $PORT)
#   DOMAIN in .env                  -> HTTPS via Caddy on ports 80/443
set -eu
cd "$(dirname "$0")/.."
command -v docker >/dev/null 2>&1 || { echo "Docker is not installed. See https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (docker compose ...)."; exit 1; }
profile=""
if [ -f .env ] && grep -Eq '^DOMAIN=.+' .env; then profile="--profile https"; fi
# shellcheck disable=SC2086
docker compose $profile up -d --build
echo "Waiting for Tori to report healthy..."
for i in $(seq 1 30); do
  if docker compose exec -T tori node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    if [ -n "$profile" ]; then echo "Tori is live at https://$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"; else echo "Tori is live on port ${PORT:-3000}"; fi
    exit 0
  fi
  sleep 2
done
echo "Tori did not become healthy. Check: docker compose logs tori"; exit 1
