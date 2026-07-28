#!/usr/bin/env python3
"""Issue or rotate a contributor's credentials from the editorial desk.

    python3 scripts/desk_credentials.py codex-first-scribe
    python3 scripts/desk_credentials.py codex-first-scribe --recovery-only

Why this exists
---------------
`rotate_key` over MCP now demands the recovery code issued at registration.
Everyone who registered before that change has none, so the tool refuses them —
which is the correct answer, but only if a desk path exists. This is that path.

It is deliberately not a tool. Rotating someone's key by hand should require a
person with the database password, because the whole point of the change is
that a handle cannot be seized by whoever knows its name.

Secrets never reach stdout. They are written to an env file (.env.local by
default, already ignored by Git) because the instruction that prompted this was
exactly that: do not paste the key into a chat window. What the terminal prints
is which handle changed and where the values went — enough to know it worked,
not enough to leak.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import pathlib
import re
import secrets
import sys

import psycopg2
import psycopg2.extras

ROOT = pathlib.Path(__file__).resolve().parent.parent


def env_file(name: str) -> dict[str, str]:
    out: dict[str, str] = {}
    p = ROOT / name
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"')
    return out


def connect():
    env = env_file(".env")
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "127.0.0.1"),
        port=int(os.environ.get("PGPORT", "6000")),
        dbname=os.environ.get("PGDATABASE", "terraveler"),
        user=os.environ.get("PGUSER", "terraveler"),
        password=os.environ.get("PGPASSWORD") or env.get("POSTGRES_PASSWORD", ""),
    )


def put(path: pathlib.Path, key: str, value: str) -> None:
    """Set one variable in an env file, replacing any existing line."""
    lines = path.read_text().splitlines() if path.exists() else []
    lines = [l for l in lines if not re.match(rf"^{re.escape(key)}\s*=", l)]
    lines.append(f"{key}={value}")
    path.write_text("\n".join(lines).strip() + "\n")
    path.chmod(0o600)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("handle")
    ap.add_argument("--env-file", default=".env.local")
    ap.add_argument("--prefix", default="TERRAVELER_CONTRIBUTOR",
                    help="env variable prefix for the two values")
    ap.add_argument("--recovery-only", action="store_true",
                    help="issue a recovery code but leave the working key alone")
    args = ap.parse_args()

    conn = connect()
    cur = conn.cursor()
    cur.execute("select id, status, recovery_code_hash is not null "
                "from contributors where handle = %s", (args.handle,))
    row = cur.fetchone()
    if not row:
        print(f"unknown handle '{args.handle}'", file=sys.stderr)
        return 1
    cid, status, had_recovery = row
    if status != "active":
        print(f"contributor #{cid} is {status} — reinstate before issuing credentials",
              file=sys.stderr)
        return 1

    recovery = secrets.token_hex(18)
    sets = {"recovery_code_hash": hashlib.sha256(recovery.encode()).hexdigest()}
    key = None
    if not args.recovery_only:
        key = secrets.token_hex(24)
        sets["api_key_hash"] = hashlib.sha256(key.encode()).hexdigest()

    cur.execute(
        "update contributors set " + ", ".join(f"{k} = %s" for k in sets)
        + " where id = %s",
        (*sets.values(), cid),
    )
    # The desk is not exempt from the log. A credential change that leaves no
    # trace is the shortcut this whole change exists to close.
    cur.execute(
        "insert into audit_log (actor, action, verdict, findings, carta_version) "
        "values (%s, %s, %s, %s, %s)",
        ("editor-in-chief", "credentials",
         "recovery-issued" if args.recovery_only else "key-rotated",
         psycopg2.extras.Json({"handle": args.handle,
                               "had_recovery_code": had_recovery}),
         "0.4"),
    )
    conn.commit()

    path = ROOT / args.env_file
    put(path, f"{args.prefix}_RECOVERY_CODE", recovery)
    if key:
        put(path, f"{args.prefix}_API_KEY", key)

    print(f"#{cid} {args.handle}: "
          + ("recovery code issued" if args.recovery_only else "key rotated, recovery code issued"))
    print(f"written to {args.env_file} (mode 600) as {args.prefix}_"
          + ("RECOVERY_CODE" if args.recovery_only else "{API_KEY,RECOVERY_CODE}"))
    print("Not printed here on purpose. Read the file if you need the values.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
