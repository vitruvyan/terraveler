#!/usr/bin/env bash
# Installs the two Terraveler vhosts and reloads nginx.
#
# Exists because the equivalent one-liner is long enough that terminals wrap it
# mid-path, and the pieces then run as separate broken commands.
#
# Safe to re-run: it copies, tests, and only reloads if the test passes.

set -u
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST=/etc/nginx/sites-available

echo "sorgente: $SRC"

for f in rag.terraveler.com api.terraveler.com; do
    if [ ! -f "$SRC/$f" ]; then
        echo "ERRORE: manca $SRC/$f" >&2
        exit 1
    fi
done

for f in rag.terraveler.com api.terraveler.com; do
    sudo cp "$SRC/$f" "$DST/$f" || { echo "ERRORE: copia di $f fallita" >&2; exit 1; }
    n=$(grep -c 'listen 443' "$DST/$f")
    echo "copiato $f  (blocchi 443 nel file installato: $n)"
done

echo
echo "--- nginx -t ---"
if sudo nginx -t; then
    sudo systemctl reload nginx && echo "RELOAD OK"
else
    echo "nginx -t FALLITO — nessun reload eseguito, resta attiva la config precedente" >&2
    exit 1
fi
