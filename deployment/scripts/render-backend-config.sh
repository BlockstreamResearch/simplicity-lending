#!/bin/sh
set -eu

CONFIG_DIR="/app/crates/indexer/configuration"

mkdir -p "$CONFIG_DIR"

envsubst < /deployment/configs/backend/base.yaml.template > "$CONFIG_DIR/base.yaml"
envsubst < /deployment/configs/backend/production.yaml.template > "$CONFIG_DIR/production.yaml"

exec "$@"
