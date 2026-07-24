#!/bin/bash
# Mint the PostgREST service token — the VPS equivalent of Supabase's
# SUPABASE_SERVICE_KEY. Prints a JWT claiming role=terraveler_service, which
# bypasses RLS exactly as Supabase's service_role does.
#
# Set it on Vercel as the key the desk, /contribute and the MCP server send.
# There is no exp claim: this is a service credential, and it is rotated by
# changing PGRST_JWT_SECRET in .env and restarting terraveler_postgrest —
# which invalidates every token ever minted, in one move.
#
# Usage:  ./db/mint-service-token.sh          (reads PGRST_JWT_SECRET from .env)

set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env here" >&2; exit 1; }
set -a; . ./.env; set +a
[ -n "${PGRST_JWT_SECRET:-}" ] || { echo "PGRST_JWT_SECRET not set in .env" >&2; exit 1; }

ROLE="${1:-terraveler_service}"
ROLE="$ROLE" python3 -c '
import hmac, hashlib, base64, json, os
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=")
secret = os.environ["PGRST_JWT_SECRET"].encode()
h = b64(json.dumps({"alg":"HS256","typ":"JWT"}, separators=(",",":")).encode())
p = b64(json.dumps({"role":os.environ["ROLE"]}, separators=(",",":")).encode())
s = b64(hmac.new(secret, h + b"." + p, hashlib.sha256).digest())
print((h + b"." + p + b"." + s).decode())
'
