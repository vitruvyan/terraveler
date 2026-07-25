# Terraveler RAG — the /chat endpoint Vercel calls.
#
# The TLS block below is hand-written, not certbot's. Certbot 1.21.0 cannot
# install it here: its nginx plugin builds the SSL block around a placeholder
# certificate whose key is hardcoded to RSA-1024 (configurator.py:679), and
# cryptography 45 refuses to generate a key that small. The certificate itself
# was issued normally, and renewals do not touch this code path — certbot's
# renew "saves but does not install", it only reloads nginx. See ops/nginx/README.md.

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name rag.terraveler.com;

    ssl_certificate     /etc/letsencrypt/live/rag.terraveler.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rag.terraveler.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:6003;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # A /chat answer runs embed → retrieve → evaluate → generate against
        # OpenAI, so it can outlast nginx's 60s default. Measured 1.9-7.4s in
        # practice; the headroom is for a slow upstream, not the normal case.
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name rag.terraveler.com;

    # Kept ahead of the redirect: http-01 renewals must be answerable on :80
    # even though certbot's authenticator normally injects its own location.
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
