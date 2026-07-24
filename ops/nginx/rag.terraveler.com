# Terraveler RAG — the /chat endpoint Vercel calls.
#
# HTTP-only on purpose: install this, reload, then let certbot --nginx add the
# 443 block and the redirect. Writing the TLS block by hand here would make
# `nginx -t` fail, because it would reference certificates that do not exist yet.

server {
    listen 80;
    listen [::]:80;
    server_name rag.terraveler.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

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
