# Terraveler governance API — PostgREST, replacing Supabase's /rest/v1.
#
# The desk, /contribute and the MCP server reach this. Callers send a JWT that
# bypasses RLS, so this host must never serve their traffic over plain HTTP.
#
# PostgREST stays bound to 127.0.0.1:6004 — this vhost is its only way out.
#
# The TLS block below is hand-written, not certbot's. Certbot 1.21.0 cannot
# install it here: its nginx plugin builds the SSL block around a placeholder
# certificate whose key is hardcoded to RSA-1024 (configurator.py:679), and
# cryptography 45 refuses to generate a key that small. The certificate itself
# was issued normally, and renewals do not touch this code path — certbot's
# renew "saves but does not install", it only reloads nginx. See ops/nginx/README.md.
#
# This host has its own lineage, issued separately from rag.terraveler.com's.

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name api.terraveler.com;

    ssl_certificate     /etc/letsencrypt/live/api.terraveler.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.terraveler.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        # Supabase serves PostgREST under /rest/v1/; the callers' paths are
        # built as ${SB_URL}/rest/v1/<table>. Stripping the prefix here means
        # SB_URL becomes https://api.terraveler.com and the queries in
        # deskAuth.ts, mcp/route.ts and contribute/route.ts stay untouched.
        rewrite ^/rest/v1/(.*)$ /$1 break;

        proxy_pass http://127.0.0.1:6004;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Submission payloads are jsonb documents, not form fields.
        client_max_body_size 10m;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name api.terraveler.com;

    # Kept ahead of the redirect: http-01 renewals must be answerable on :80
    # even though certbot's authenticator normally injects its own location.
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
