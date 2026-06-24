#!/bin/sh
set -eu

envsubst '${WEB_ESPLORA_API_UPSTREAM} ${WEB_PRICES_API_UPSTREAM}' \
  < /deployment/configs/nginx/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec "$@"
