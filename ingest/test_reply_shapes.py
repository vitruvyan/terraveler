"""Reading a Claude reply, pinned against the shape that broke a run.

    python3 -m unittest test_reply_shapes -v      (from ingest/)

The planner read content[0]["text"] and assumed the first block was text.
A reply whose first block was something else raised KeyError('text'), the
exploration policy swallowed it, and the run went on to write a submission with
zero waypoints that looked like a completed voyage. Lewis & Clark — 6,052
chunks of journal in the corpus — was published-shaped and empty.

Loaded out of the source rather than imported, for the reason test_chronology
gives: extract_core.py needs psycopg2 and the fetch layer; this function needs neither.
"""
import ast
import unittest
from pathlib import Path

SRC = (Path(__file__).parent / "extract_core.py").read_text(encoding="utf-8")


def _load():
    tree = ast.parse(SRC)
    picked = [n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name == "_anthropic_text"]
    assert picked, "extract_core.py no longer defines _anthropic_text"
    ns = {}
    exec(compile(ast.Module(body=picked, type_ignores=[]), "<extract>", "exec"), ns)
    return ns["_anthropic_text"]


anthropic_text = _load()


def block(kind, **kw):
    return {"type": kind, **kw}


class ReplyShapes(unittest.TestCase):
    def test_the_ordinary_reply(self):
        self.assertEqual(
            anthropic_text({"content": [block("text", text='{"stops": []}')]}),
            '{"stops": []}')

    def test_a_thinking_block_first_no_longer_kills_the_run(self):
        """The exact failure. Before the fix this raised KeyError('text')."""
        reply = {"content": [block("thinking", thinking="weighing the stops"),
                             block("text", text='{"stops": [1]}')],
                 "stop_reason": "end_turn"}
        self.assertEqual(anthropic_text(reply), '{"stops": [1]}')

    def test_text_split_across_blocks_is_joined(self):
        reply = {"content": [block("text", text='{"stops":'),
                             block("text", text=' [1, 2]}')]}
        self.assertEqual(anthropic_text(reply), '{"stops": [1, 2]}')

    def test_a_reply_with_no_text_says_why(self):
        with self.assertRaises(RuntimeError) as cm:
            anthropic_text({"content": [block("thinking", thinking="…")],
                            "stop_reason": "max_tokens"})
        msg = str(cm.exception)
        # The old error said 'text' and nothing else. This one has to name both
        # what came back and why it stopped, or the next debug is guesswork.
        self.assertIn("max_tokens", msg)
        self.assertIn("thinking", msg)

    def test_an_empty_reply_is_an_error_not_an_empty_plan(self):
        for reply in ({"content": []}, {}, {"content": [block("text", text="  ")]}):
            with self.assertRaises(RuntimeError):
                anthropic_text(reply)


if __name__ == "__main__":
    unittest.main()
