#!/bin/sh
set -eu

envsubst '${WEB_ESPLORA_API_UPSTREAM}' \
  < /deployment/configs/nginx/default.conf.template \
  > /etc/nginx/conf.d/default.conf

envsubst '${REOWN_PROJECT_ID} ${WALLET_ABI_NETWORK} ${WEB_ESPLORA_EXPLORER_URL}' \
  < /deployment/configs/web/runtime-config.js.template \
  > /usr/share/nginx/html/runtime-config.js

exec "$@"
