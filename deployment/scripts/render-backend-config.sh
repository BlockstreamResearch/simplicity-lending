#!/bin/sh
set -eu

CONFIG_DIR="/app/crates/indexer/configuration"

mkdir -p "$CONFIG_DIR"

envsubst < /deployment/configs/backend/base.yaml.template > "$CONFIG_DIR/base.yaml"
envsubst < /deployment/configs/backend/production.yaml.template > "$CONFIG_DIR/production.yaml"

if [ "${RUN_MODE:-api}" = "migrate" ]; then
  export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
  exec sqlx migrate run --source /app/crates/indexer/migrations
fi

exec "$@"
