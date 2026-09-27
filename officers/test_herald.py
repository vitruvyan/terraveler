#!/usr/bin/env python3
"""The Herald's message composition, pinned (docs/SHIPS_OFFICERS.md §4.4).

    python3 -m unittest test_herald -v          (from officers/)

No database, no network, no Redis: compose_herald_message is a pure
function (payload in, text or None out), and that is the whole reason it is
kept separate from herald_handler — a Herald that decides nothing and adds
no judgment of its own should be checkable without standing up the wire it
listens on.
"""
import unittest

from dispatcher import compose_herald_message


class EscalationMessage(unittest.TestCase):
    def test_includes_submission_and_reason(self):
        text = compose_herald_message("escalation.raised", {
            "submission_id": 42,
            "findings": [["ESCALATE", 0, "no reviewer on the dossier carries independent trust"]],
        })
        self.assertIn("#42", text)
        self.assertIn("no reviewer on the dossier carries independent trust", text)

    def test_missing_findings_still_produces_a_message(self):
        text = compose_herald_message("escalation.raised", {"submission_id": 7})
        self.assertIn("#7", text)
        self.assertIn("no reason recorded", text)


class AppealMessage(unittest.TestCase):
    def test_includes_submission_and_reason(self):
        text = compose_herald_message("appeal.filed", {
            "submission_id": 9,
            "findings": [["INFO", 0, "the reviewer misread the quotation's context"]],
        })
        self.assertIn("#9", text)
        self.assertIn("misread the quotation", text)


class DlqMessage(unittest.TestCase):
    def test_includes_stream_and_reason(self):
        text = compose_herald_message("dlq.entry", {
            "original_stream": "terraveler:editorial:reviews.advanced",
            "failure_reason": "desk_review.py exited 1",
            "retry_count": 3,
        })
        self.assertIn("terraveler:editorial:reviews.advanced", text)
        self.assertIn("desk_review.py exited 1", text)
        self.assertIn("3", text)


class UnknownEventType(unittest.TestCase):
    def test_returns_none_rather_than_guessing(self):
        self.assertIsNone(compose_herald_message("something.new", {"submission_id": 1}))


if __name__ == "__main__":
    unittest.main()
