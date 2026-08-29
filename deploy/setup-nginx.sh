#!/usr/bin/env bash
#
# nginx reverse proxy + Let's Encrypt for BOTH apps on one VPS:
#   app.<domain>   -> Dostoori      (127.0.0.1:3000)
#   legal.<domain> -> ailegal_hussein admin / standalone face (127.0.0.1:4000)
#
#   bash deploy/setup-nginx.sh yourdomain.com
#
# Point BOTH A records (app.<domain>, legal.<domain>) at this VPS BEFORE
# running — certbot proves ownership over HTTP and needs DNS to resolve.
#
# This supersedes ailegal_hussein/deploy/setup-nginx.sh; ailegal's compose
# only needs to publish 127.0.0.1:4000:3000.
set -euo pipefail

DOMAIN="${1:-}"
[[ -n "$DOMAIN" ]] || { echo "Usage: bash deploy/setup-nginx.sh yourdomain.com" >&2; exit 1; }
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }

APP_HOST="app.${DOMAIN}"
LEGAL_HOST="legal.${DOMAIN}"

echo "==> Writing nginx config for ${APP_HOST} + ${LEGAL_HOST}"

# One shared proxy block: SSE needs buffering off, the AI routes routinely run
# past nginx's 60s default, and uploads need the raised body limit.
common_proxy() {
  cat <<EOF
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        'upgrade';
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
EOF
}

cat >"/etc/nginx/sites-available/${DOMAIN}" <<EOF
server {
    listen 80;
    server_name ${APP_HOST};
    client_max_body_size 25M;
    location / {
        proxy_pass http://127.0.0.1:3000;
$(common_proxy)
    }
}

server {
    listen 80;
    server_name ${LEGAL_HOST};
    client_max_body_size 25M;
    location / {
        proxy_pass http://127.0.0.1:4000;
$(common_proxy)
    }
}
EOF

ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default

echo "==> Testing config"
nginx -t
systemctl reload nginx

echo "==> Requesting certificates"
command -v certbot &>/dev/null || apt-get install -y -qq certbot python3-certbot-nginx

# --redirect: session cookies are `Secure` in production, so they would not
# stick over plain HTTP and the site would look broken.
certbot --nginx -d "${APP_HOST}" -d "${LEGAL_HOST}" --non-interactive --agree-tos --redirect \
  --register-unsafely-without-email || {
  echo "certbot failed — are ${APP_HOST} and ${LEGAL_HOST} pointing at this server yet?" >&2
  exit 1
}

echo ""
echo "==> Live:"
echo "    Dostoori:       https://${APP_HOST}"
echo "    ailegal admin:  https://${LEGAL_HOST}/admin"
echo "    Renewal is handled by certbot's systemd timer."
