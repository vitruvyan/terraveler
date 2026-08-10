#!/usr/bin/env python3
"""Publish a verdict trace's root on TRON, and read it back to prove it.

    python3 scripts/anchor.py --submission 28      # anchor its latest verdict
    python3 scripts/anchor.py --verify 28          # re-read the chain and check
    python3 scripts/anchor.py --root sha256:…      # anchor a root directly
    python3 scripts/anchor.py --balance            # what the wallet holds

Why a chain at all
------------------
`verdict_traces` holds an immutable, hash-chained trace of every Curator
verdict, and `motus-validate` refuses one that has been altered. That closes
the question "was this record edited?" only for someone who did not do the
editing. Whoever holds the database password can rewrite the verdict AND
recompute the chain over the rewrite, and the result validates perfectly. What
they cannot do is reach back in time and change a value that was published
somewhere they do not control, before the edit.

That value is the root, and this is what publishes it. Nothing else goes on
chain: the trace stays in Postgres, the draft stays in Postgres, and the only
thing a reader of the blockchain learns is that a 32-byte digest existed at a
particular block height. Off-chain processing, on-chain anchoring — the design
is `vitruvyan/mercator`, `.github/Vitruvyan_Appendix_H_Blockchain_Ledger.md`,
and it is the reason there is no smart contract here to write or to audit: the
digest travels in the transaction's memo field.

The two halves, and why the second one is the one that counts
-------------------------------------------------------------
`anchor()` sends. `verify()` reads back from the chain and confirms the memo
carries this root and no other. The second half is the one people skip and the
only one that proves anything: an anchor nobody re-reads is a transaction, not
evidence.

Where this sits
---------------
Motus ships no anchor and holds no chain credentials — decision on record,
`vitruvyan/motus` issue #51: the repository provides the socket, not the plug.
So this reads `trace.root` and publishes it itself. It is written to sit behind
that interface the day it exists: one root in, one receipt out, and not a
single Motus internal touched. `anchor()` and `verify()` take strings and
dicts, and would keep working if Motus disappeared.

Batching — later, not now
-------------------------
Appendix H proposes 100 events per anchor behind a Merkle root. Not yet. A
batching scheme whose single-item case was never made to work is a scheme
nobody can debug, and the single-item case is what this file is for.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent

MEMO_PREFIX = "VITRUVYAN_AUDIT:"
MEMO_LIMIT = 100
# A memo-carrying transfer of 1 SUN. The transfer is the carrier and not the
# point: value moves so that a memo has somewhere to ride.
SUN = 1


class AnchorRefused(Exception):
    """The anchor declined to publish. Always the anchor's own refusal, never
    a chain error dressed up as one."""


# ------------------------------------------------------------- configuration

def config(env: dict | None = None) -> dict:
    """The six values, out of `terraveler/.env`.

    Never out of the motus repository: its kernel reads no environment
    variables at all, by design, and a chain credential is the last thing that
    should start being an exception to that.
    """
    values = dict(env or {})
    if not values:
        f = ROOT / ".env"
        if f.exists():
            for line in f.read_text().splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    k, v = line.split("=", 1)
                    values[k.strip()] = v.strip().strip('"')
        values.update({k: v for k, v in os.environ.items() if k.startswith("TRON_")})

    cfg = {k: values.get(k, "") for k in
           ("TRON_NETWORK", "TRON_ENDPOINT", "TRON_API_KEY",
            "TRON_WALLET_ADDRESS", "TRON_PRIVATE_KEY", "TRON_ANCHOR_ADDRESS")}
    missing = [k for k, v in cfg.items() if not v or v.startswith("<")]
    if missing:
        raise AnchorRefused(
            "missing TRON configuration in terraveler/.env: " + ", ".join(missing))
    if cfg["TRON_NETWORK"] != "nile":
        # Deliberate, and not a placeholder for a future flag. Mainnet costs
        # real TRX and publishes irrevocably; turning it on should be an
        # editorial decision someone makes on purpose, in a commit with their
        # name on it, not a value that leaked in from an environment.
        raise AnchorRefused(
            f"TRON_NETWORK is {cfg['TRON_NETWORK']!r}. This anchor only speaks to "
            f"Nile, the testnet. Publishing on mainnet spends real TRX and is "
            f"irreversible — it is a decision, not a configuration change.")
    return cfg


def _client(cfg: dict):
    """The RPC client. Always with the API key, even on Nile.

    Nile often answers without one at a lower rate limit, which is exactly the
    trap: keyless code works here and then meets a network that refuses it.
    """
    from tronpy import Tron
    from tronpy.providers import HTTPProvider
    return Tron(HTTPProvider(endpoint_uri=cfg["TRON_ENDPOINT"],
                             api_key=cfg["TRON_API_KEY"]),
                network=cfg["TRON_NETWORK"])


# ------------------------------------------------------------------ the memo

def memo_for(root: str) -> str:
    """The one string that goes on chain, and the assertion that it fits.

    `VITRUVYAN_AUDIT:` is 16 characters and a Motus root is `sha256:` plus 64
    hex — 71 — so the memo is 87 of the 100 a TRON memo allows. (The migration
    brief computed 80, assuming a bare digest; Motus 0.8.1 names its hash
    function in the value and that prefix is kept, because a digest that does
    not say what produced it is a digest nobody can re-compute.)

    Checked rather than assumed: a memo that overflows is silently truncated by
    some clients, and a truncated digest is a digest that matches nothing while
    looking like it should.
    """
    if not isinstance(root, str) or not root:
        raise AnchorRefused("a root must be a non-empty string")
    if not root.startswith("sha256:") or len(root) != 71:
        raise AnchorRefused(
            f"a Motus trace root is 'sha256:' and 64 hex characters; got "
            f"{len(root)} characters starting {root[:12]!r}")
    memo = MEMO_PREFIX + root
    if len(memo) > MEMO_LIMIT:
        raise AnchorRefused(
            f"memo is {len(memo)} characters, over the {MEMO_LIMIT} a TRON "
            f"memo carries — it would be truncated and the anchor would prove "
            f"nothing")
    return memo


def root_in(memo: str) -> str | None:
    """The root a memo carries, or None if it carries something else."""
    if not isinstance(memo, str) or not memo.startswith(MEMO_PREFIX):
        return None
    return memo[len(MEMO_PREFIX):] or None


def _memo_of(transaction: dict) -> str | None:
    """The memo of a transaction as the node returns it: hex, under
    `raw_data.data`."""
    raw = (transaction or {}).get("raw_data") or {}
    data = raw.get("data")
    if not data:
        return None
    try:
        return bytes.fromhex(data).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


# ------------------------------------------------------------- the two halves

def anchor(root: str, *, cfg: dict | None = None, client=None,
           wait: bool = True) -> dict:
    """Publish one trace root. Returns the receipt: txid, network, timestamp.

    One root in, one receipt out. No Motus internals — a string arrives and a
    dict leaves — so this slots behind Motus's anchor interface the day that
    interface exists (vitruvyan/motus #51) without being rewritten.
    """
    cfg = cfg or config()
    memo = memo_for(root)                       # asserts before anything is sent
    client = client or _client(cfg)

    from tronpy.keys import PrivateKey
    priv = PrivateKey(bytes.fromhex(cfg["TRON_PRIVATE_KEY"]))

    txn = (client.trx
           .transfer(cfg["TRON_WALLET_ADDRESS"], cfg["TRON_ANCHOR_ADDRESS"], SUN)
           .memo(memo)
           .build()
           .sign(priv))
    sent = txn.broadcast()
    txid = sent.txid if hasattr(sent, "txid") else sent["txid"]
    confirmed = None
    if wait:
        try:
            confirmed = sent.wait(timeout=60)
        except Exception as exc:                # noqa: BLE001 — reported, not hidden
            # Broadcast succeeded and confirmation did not arrive in a minute.
            # That is a fact about the network, not a failed anchor, and the
            # receipt says so rather than pretending either way. `verify()`
            # settles it later.
            confirmed = {"unconfirmed": type(exc).__name__}
    return {
        "root": root,
        "memo": memo,
        "txid": txid,
        "network": cfg["TRON_NETWORK"],
        "from": cfg["TRON_WALLET_ADDRESS"],
        "to": cfg["TRON_ANCHOR_ADDRESS"],
        "amount_sun": SUN,
        "anchored_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "confirmation": confirmed,
        "explorer": f"https://nile.tronscan.org/#/transaction/{txid}",
    }


def verify(root: str, receipt: dict, *, cfg: dict | None = None, client=None) -> bool:
    """Re-read the transaction from the chain and confirm it carries this root.

    The half people forget and the only half that proves anything. It reads the
    chain and never the receipt's own copy of the memo: a receipt is a local
    file, and a local file that certifies itself certifies nothing.
    """
    if not receipt or not receipt.get("txid"):
        return False
    cfg = cfg or config()
    if receipt.get("network") != cfg["TRON_NETWORK"]:
        return False
    client = client or _client(cfg)
    try:
        transaction = client.get_transaction(receipt["txid"])
    except Exception:                            # noqa: BLE001
        # Unknown txid, or the node could not be reached. Neither is a
        # confirmation, and `verify` answers the question it was asked.
        return False
    on_chain = root_in(_memo_of(transaction) or "")
    return bool(on_chain) and on_chain == root


# ------------------------------------------------------------ the persistence

def ensure_columns(pg: dict) -> None:
    import psycopg2
    conn = psycopg2.connect(**pg)
    try:
        with conn, conn.cursor() as cur:
            cur.execute("alter table verdict_traces "
                        " add column if not exists anchor_txid text,"
                        " add column if not exists anchor_receipt jsonb,"
                        " add column if not exists anchored_at timestamptz;")
            cur.execute("create unique index if not exists verdict_traces_txid "
                        "on verdict_traces (anchor_txid) where anchor_txid is not null;")
    finally:
        conn.close()


def latest_trace(pg: dict, submission_id: int) -> dict | None:
    import psycopg2, psycopg2.extras
    conn = psycopg2.connect(**pg)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("select id, run_id, verdict, root, anchor_txid, anchor_receipt"
                        "  from verdict_traces"
                        " where submission_id = %s and root is not null"
                        " order by id desc limit 1", (submission_id,))
            row = cur.fetchone()
    finally:
        conn.close()
    return dict(row) if row else None


def store_receipt(pg: dict, trace_id: int, receipt: dict) -> None:
    import psycopg2, psycopg2.extras
    conn = psycopg2.connect(**pg)
    try:
        with conn, conn.cursor() as cur:
            cur.execute("update verdict_traces set anchor_txid=%s, anchor_receipt=%s,"
                        " anchored_at=now() where id=%s",
                        (receipt["txid"], psycopg2.extras.Json(receipt), trace_id))
    finally:
        conn.close()


# -------------------------------------------------------------------- the CLI

def main() -> int:
    sys.path.insert(0, str(ROOT / "scripts"))
    import desk_review

    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--submission", type=int, help="anchor this submission's latest verdict trace")
    g.add_argument("--verify", type=int, metavar="SUBMISSION",
                   help="re-read the chain and confirm this submission's anchor")
    g.add_argument("--root", help="anchor a root directly, storing no receipt")
    g.add_argument("--balance", action="store_true")
    args = ap.parse_args()

    cfg = config()

    if args.balance:
        from tronpy.exceptions import AddressNotFound
        client = _client(cfg)
        print(f"network  {cfg['TRON_NETWORK']}")
        print(f"wallet   {cfg['TRON_WALLET_ADDRESS']}")
        try:
            trx = client.get_account_balance(cfg["TRON_WALLET_ADDRESS"])
        except AddressNotFound:
            # Not an error and not an empty account either. TRON creates the
            # account record on its first incoming transfer, so an address that
            # has never been funded does not exist on chain at all — which is
            # exactly what a freshly generated keypair looks like, and saying
            # "0 TRX" here would hide the difference.
            trx = None
            print("balance  the account does not exist on chain yet — it is "
                  "created by its first incoming transfer")
        else:
            print(f"balance  {trx} TRX")
        print(f"explorer https://nile.tronscan.org/#/address/{cfg['TRON_WALLET_ADDRESS']}")
        if not trx:
            print("\nThe Nile faucet at https://nileex.io gives 2000 TRX per address\n"
                  "per day. Paste the address above, wait for the transaction, and\n"
                  "run this again.")
            return 1
        return 0

    if args.root:
        receipt = anchor(args.root, cfg=cfg)
        print(json.dumps(receipt, indent=2))
        print(f"\nverify: {verify(args.root, receipt, cfg=cfg)}")
        return 0

    pg = desk_review.pg_params()
    ensure_columns(pg)

    if args.verify is not None:
        row = latest_trace(pg, args.verify)
        if not row:
            print(f"no verdict trace with a root for submission #{args.verify}")
            return 1
        if not row["anchor_receipt"]:
            print(f"submission #{args.verify}: trace {row['run_id']} is not anchored")
            return 1
        ok = verify(row["root"], row["anchor_receipt"], cfg=cfg)
        print(f"#{args.verify}  {row['run_id']}")
        print(f"  verdict  {row['verdict']}")
        print(f"  root     {row['root']}")
        print(f"  txid     {row['anchor_txid']}")
        print(f"  on chain {'YES — the memo carries this root' if ok else 'NO'}")
        return 0 if ok else 1

    row = latest_trace(pg, args.submission)
    if not row:
        print(f"no verdict trace with a root for submission #{args.submission} — "
              f"run scripts/desk_review.py {args.submission} first")
        return 1
    if row["anchor_txid"]:
        print(f"already anchored: {row['anchor_txid']}")
        return 0
    receipt = anchor(row["root"], cfg=cfg)
    store_receipt(pg, row["id"], receipt)
    print(f"#{args.submission}  {row['run_id']}  {row['verdict']}")
    print(f"  root     {row['root']}")
    print(f"  memo     {receipt['memo']}  ({len(receipt['memo'])}/{MEMO_LIMIT} characters)")
    print(f"  txid     {receipt['txid']}")
    print(f"  explorer {receipt['explorer']}")
    print(f"  verify   {verify(row['root'], receipt, cfg=cfg)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
