#!/usr/bin/env bash
#
# nginx reverse proxy + Let's Encrypt certificate.
#
#   bash deploy/setup-nginx.sh your-domain.com
#
# Point the domain's A record at this VPS's IP BEFORE running: certbot proves
# ownership by fetching a file over HTTP, which cannot work until DNS resolves.
set -euo pipefail

DOMAIN="${1:-}"
[[ -n "$DOMAIN" ]] || { echo "Usage: bash deploy/setup-nginx.sh your-domain.com" >&2; exit 1; }
[[ $EUID -eq 0 ]] || { echo "Run as root." >&2; exit 1; }

echo "==> Writing nginx config for ${DOMAIN}"

cat >"/etc/nginx/sites-available/${DOMAIN}" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    # Admin PDF uploads are the largest bodies; the default 1M rejects them
    # with a 413 before the app is ever reached.
    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host              \$host;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        'upgrade';
        # Without these the app sees every visitor as 127.0.0.1 and the
        # analytics visitor count collapses to 1.
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # SSE: nginx buffers proxied responses by default, which holds the
        # whole answer until it completes and kills streaming entirely.
        proxy_buffering off;
        proxy_cache off;

        # Ingest and OCR routinely exceed the 60s default.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF

ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default

echo "==> Testing config"
nginx -t
systemctl reload nginx

echo "==> Requesting certificate"
if ! command -v certbot &>/dev/null; then
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# --redirect makes certbot rewrite the vhost to force HTTPS. Session cookies
# are set `secure` in production, so they simply would not stick over plain
# HTTP — the site would look broken, not merely insecure.
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --redirect \
  --register-unsafely-without-email || {
  echo "certbot failed — is ${DOMAIN}'s A record pointing at this server yet?" >&2
  exit 1
}

echo ""
echo "==> Live at https://${DOMAIN}"
echo "    Admin:  https://${DOMAIN}/admin"
echo "    Renewal is handled by certbot's systemd timer — nothing to schedule."
