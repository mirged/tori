#!/bin/sh
# Fly volumes are mounted owned by root. Hand the database folder to the
# unprivileged node user, then run Tori as that user (never as root).
set -eu
dir=$(dirname "${DATABASE_PATH:-/data/tori.sqlite}")
mkdir -p "$dir"
chown -R node:node "$dir"
exec setpriv --reuid=node --regid=node --init-groups -- "$@"
