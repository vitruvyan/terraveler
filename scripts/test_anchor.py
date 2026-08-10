#!/usr/bin/env python3
"""The anchor, without a chain.

    python3 -m unittest test_anchor -v              (from scripts/)

Everything here runs offline against a stub node. That is not a compromise:
the assertions worth making about an anchor are about what it refuses — an
oversized memo, a root that is not a root, a network it must not speak to, a
transaction whose memo carries somebody else's digest — and none of those need
a live chain to demonstrate. What needs the chain is a single end-to-end run,
and that one is performed by hand and its txid recorded, because a test that
spends testnet TRX on every invocation is a test nobody runs.

The one that matters is `AlteredTrace`. Publishing a root proves nothing unless
a DIFFERENT root fails against the same receipt — otherwise `verify()` is a
function that returns True.
"""
from __future__ import annotations

import hashlib
import pathlib
import sys
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import anchor as A                                         # noqa: E402


def root_of(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


NILE = {
    "TRON_NETWORK": "nile",
    "TRON_ENDPOINT": "https://nile.trongrid.io",
    "TRON_API_KEY": "0000000-0000-0000-0000-000000000000",
    "TRON_WALLET_ADDRESS": "TJLZ4eg91beJW72RfF76p3gQFXKKREro4g",
    "TRON_PRIVATE_KEY": "00" * 32,
    "TRON_ANCHOR_ADDRESS": "TX1MPANGu47kKzKXcrUkdvZ9sf9yWxpVK5",
}


class StubClient:
    """A node that returns exactly one transaction, with exactly one memo."""

    def __init__(self, txid: str, memo: str | None):
        self.txid, self.memo = txid, memo

    def get_transaction(self, txn_id: str) -> dict:
        if txn_id != self.txid:
            raise LookupError("transaction not found")
        if self.memo is None:
            return {"raw_data": {}}
        return {"raw_data": {"data": self.memo.encode("utf-8").hex()}}


class TheMemo(unittest.TestCase):
    """Step 0 of the phase's own checklist: assert the memo fits BEFORE
    sending, not after."""

    def test_a_real_root_fits_with_room_to_spare(self):
        memo = A.memo_for(root_of("a verdict"))
        self.assertEqual(len(memo), 87)          # 16 prefix + 7 'sha256:' + 64 hex
        self.assertLessEqual(len(memo), A.MEMO_LIMIT)
        self.assertTrue(memo.startswith("VITRUVYAN_AUDIT:"))

    def test_the_root_survives_the_round_trip(self):
        root = root_of("a verdict")
        self.assertEqual(A.root_in(A.memo_for(root)), root)

    def test_a_memo_that_is_not_ours_yields_no_root(self):
        self.assertIsNone(A.root_in("hello"))
        self.assertIsNone(A.root_in(""))
        self.assertIsNone(A.root_in("VITRUVYAN_AUDIT:"))

    def test_a_bare_digest_is_refused(self):
        """The brief assumed a 64-hex root and computed 80 characters. Motus
        names its hash function in the value, and a digest that does not say
        what produced it is one nobody can re-compute — so the prefix is
        required rather than tolerated."""
        with self.assertRaises(A.AnchorRefused):
            A.memo_for("a" * 64)

    def test_something_that_is_not_a_root_at_all_is_refused(self):
        for bad in ("", None, "sha256:", "sha256:" + "a" * 63, "sha512:" + "a" * 64):
            with self.assertRaises(A.AnchorRefused):
                A.memo_for(bad)


class TheConfiguration(unittest.TestCase):

    def test_mainnet_is_refused(self):
        with self.assertRaises(A.AnchorRefused) as caught:
            A.config({**NILE, "TRON_NETWORK": "mainnet"})
        self.assertIn("decision, not a configuration change", str(caught.exception))

    def test_a_placeholder_is_not_a_credential(self):
        with self.assertRaises(A.AnchorRefused) as caught:
            A.config({**NILE, "TRON_WALLET_ADDRESS": "<indirizzo Nile>"})
        self.assertIn("TRON_WALLET_ADDRESS", str(caught.exception))

    def test_a_missing_value_is_named(self):
        with self.assertRaises(A.AnchorRefused) as caught:
            A.config({**NILE, "TRON_API_KEY": ""})
        self.assertIn("TRON_API_KEY", str(caught.exception))


class Verify(unittest.TestCase):

    def setUp(self):
        self.root = root_of("submission 28, verdict changes")
        self.receipt = {"root": self.root, "memo": A.memo_for(self.root),
                        "txid": "abc123", "network": "nile"}

    def test_a_matching_memo_verifies(self):
        client = StubClient("abc123", A.memo_for(self.root))
        self.assertTrue(A.verify(self.root, self.receipt, cfg=NILE, client=client))

    def test_an_unknown_transaction_does_not(self):
        client = StubClient("something-else", A.memo_for(self.root))
        self.assertFalse(A.verify(self.root, self.receipt, cfg=NILE, client=client))

    def test_a_transaction_with_no_memo_does_not(self):
        client = StubClient("abc123", None)
        self.assertFalse(A.verify(self.root, self.receipt, cfg=NILE, client=client))

    def test_a_receipt_from_another_network_does_not(self):
        client = StubClient("abc123", A.memo_for(self.root))
        receipt = {**self.receipt, "network": "mainnet"}
        self.assertFalse(A.verify(self.root, receipt, cfg=NILE, client=client))

    def test_a_receipt_with_no_txid_does_not(self):
        self.assertFalse(A.verify(self.root, {"network": "nile"}, cfg=NILE,
                                  client=StubClient("abc123", "x")))

    def test_the_chain_is_read_and_never_the_receipt(self):
        """A receipt is a local file, and a local file that certifies itself
        certifies nothing. Here the receipt claims the right memo and the chain
        holds another — the chain wins."""
        client = StubClient("abc123", A.memo_for(root_of("a different verdict")))
        self.assertFalse(A.verify(self.root, self.receipt, cfg=NILE, client=client))


class AlteredTrace(unittest.TestCase):
    """The whole point of the phase.

    Change one byte of the stored trace, recompute its root, and ask the same
    receipt about the new root. It must say no — otherwise what was published
    binds nothing to anything.
    """

    def test_a_trace_edited_after_anchoring_no_longer_matches_its_anchor(self):
        trace = '{"seq":18,"kind":"transition","value":"changes"}'
        published = root_of(trace)
        receipt = {"root": published, "txid": "abc123", "network": "nile"}
        client = StubClient("abc123", A.memo_for(published))

        # As published: the chain agrees.
        self.assertTrue(A.verify(published, receipt, cfg=NILE, client=client))

        # One byte: the verdict this run recorded becomes the opposite one.
        edited = trace.replace('"changes"', '"approve"')
        self.assertNotEqual(edited, trace)
        recomputed = root_of(edited)
        self.assertNotEqual(recomputed, published)

        # And the anchor refuses it. Not because the chain changed — nothing
        # can change it — but because what is on the chain was written before
        # the edit and does not name the edited thing.
        self.assertFalse(A.verify(recomputed, receipt, cfg=NILE, client=client))


class Anchoring(unittest.TestCase):
    """`anchor()` asserts before it sends. A refusal must cost nothing."""

    def test_an_impossible_memo_is_refused_before_anything_is_broadcast(self):
        class Exploding:
            @property
            def trx(self):                       # pragma: no cover
                raise AssertionError("the anchor tried to send an invalid memo")
        with self.assertRaises(A.AnchorRefused):
            A.anchor("not-a-root", cfg=NILE, client=Exploding())


if __name__ == "__main__":
    unittest.main(verbosity=2)
