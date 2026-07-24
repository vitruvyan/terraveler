# Terraveler governance API — PostgREST, replacing Supabase's /rest/v1.
#
# The desk, /contribute and the MCP server reach this. Callers send a JWT that
# bypasses RLS, so this host must never serve their traffic over plain HTTP:
# install, reload, then run certbot --nginx before pointing Vercel at it.
#
# PostgREST stays bound to 127.0.0.1:6004 — this vhost is its only way out.

server {
    listen 80;
    listen [::]:80;
    server_name api.terraveler.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

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
