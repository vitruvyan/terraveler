# Publishing the VPS services over TLS

Two hosts, both proxying to services bound to `127.0.0.1`:

| Host | → | Service |
|---|---|---|
| `rag.terraveler.com` | `127.0.0.1:6003` | RAG `/chat`, called by `app/api/ask/route.ts` |
| `api.terraveler.com` | `127.0.0.1:6004` | PostgREST governance API, replacing Supabase's `/rest/v1` |

Both vhosts here are **HTTP-only by design**. Certbot adds the `443` block and
the redirect. Writing TLS by hand first would make `nginx -t` fail against
certificates that do not exist yet.

## Install

```bash
sudo cp ops/nginx/rag.terraveler.com ops/nginx/api.terraveler.com /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/rag.terraveler.com /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/api.terraveler.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d rag.terraveler.com -d api.terraveler.com
sudo nginx -t && sudo systemctl reload nginx
```

Verify before moving any traffic:

```bash
curl -s https://rag.terraveler.com/health          # {"status":"healthy",...}
curl -s -o /dev/null -w '%{http_code}\n' \
  https://api.terraveler.com/rest/v1/contributors  # 401 — no token, correct
```

## Then, and only then

1. On Vercel set `TERRAVELER_RAG_URL=https://rag.terraveler.com`, redeploy,
   confirm the site answers.
2. Close the last plaintext door: in `docker-compose.yml` change the rag port
   from `"6003:8000"` to `"127.0.0.1:6003:8000"` and
   `docker compose up -d terraveler_rag`.
3. Rotate `RAG_TOKEN` — it crossed the wire in the clear until now, so treat
   it as compromised. Expect roughly a minute of `401`s between restarting the
   container and Vercel picking up the new value; do it off-peak.

The order matters: the new path is opened and proven before the old one is
shut, so nothing is ever down.

## Ordering note for the governance API

`api.terraveler.com` carries a JWT that bypasses RLS. Do not point any caller
at it until certbot has run — that is the whole reason PostgREST is bound to
localhost rather than published directly.
