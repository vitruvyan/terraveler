# Publishing the VPS services over TLS

Two hosts, both proxying to services bound to `127.0.0.1`:

| Host | → | Service |
|---|---|---|
| `rag.terraveler.com` | `127.0.0.1:6003` | RAG `/chat`, called by `app/api/ask/route.ts` |
| `api.terraveler.com` | `127.0.0.1:6004` | PostgREST governance API, replacing Supabase's `/rest/v1` |

Each host has its **own Let's Encrypt lineage**, issued by two separate certbot
runs: `/etc/letsencrypt/live/rag.terraveler.com/` and
`/etc/letsencrypt/live/api.terraveler.com/`. Both expire 2026-10-23 and renew
independently.

## The TLS blocks are hand-written, and must stay that way

Certbot obtained the certificate but **could not install it**:

```
Successfully received certificate.
Deploying certificate
Could not install certificate
Unsupported RSA key length: 1024
```

The cause is a version skew, not a mistake in this configuration. Certbot's
nginx plugin builds an SSL block by first inserting a throwaway placeholder
certificate, whose key size is hardcoded:

```python
# /usr/lib/python3/dist-packages/certbot_nginx/_internal/configurator.py:679
le_key = crypto_util.generate_key(key_size=1024, ...)
```

This box runs certbot **1.21.0** (Ubuntu package, 2021) against **cryptography
45.0.5**, which refuses to generate RSA keys below 2048 bits. The installer
therefore cannot create an SSL block for *any* domain here. Nothing about
`rag`/`api` triggered it — the same failure would hit crumbz or vitruvyan.

So the `443` blocks in this directory were written by hand, mirroring what
certbot would have produced (`options-ssl-nginx.conf` + `ssl_dhparam`).

**Renewals are unaffected.** Certbot's renew path explicitly skips installation
— `main.py:1364`, *"Renew & save an existing cert. Do not install it."* — and
only reloads nginx afterwards. The scheduled renewal will keep working; it
never re-enters the broken code path.

Do not re-run `certbot --nginx` on these hosts hoping it will "fix" the vhosts:
it will fail the same way. If certbot is ever upgraded (snap or pip, ≥ 2.x) the
installer starts working again, and it would then rewrite these files.

## Install

```bash
sudo cp ops/nginx/rag.terraveler.com ops/nginx/api.terraveler.com /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/rag.terraveler.com /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/api.terraveler.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Verify before moving any traffic:

```bash
curl -s https://rag.terraveler.com/health          # {"status":"healthy",...}
curl -s -o /dev/null -w '%{http_code}\n' \
  https://api.terraveler.com/rest/v1/contributors  # 401 — no token, correct
curl -s -o /dev/null -w '%{http_code}\n' \
  http://rag.terraveler.com/health                 # 301 — the redirect works
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
shut, so nothing is ever down. Rotating the token before step 2 is pointless —
the new secret would cross the wire in the clear on the very next call.

## Ordering note for the governance API

`api.terraveler.com` carries a JWT that bypasses RLS. Do not point any caller
at it until TLS is verified working — that is the whole reason PostgREST is
bound to localhost rather than published directly.
