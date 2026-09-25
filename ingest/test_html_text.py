"""visible_text(): what survives from raw HTML, and what does not.

Every case in `FiveDemonstratedBypasses` reproduces one of the five ways an
external review defeated the plain `<[^>]+>` regex stripper this module
replaces — the same five payloads `verbatim.py::source_text` used to refuse
ALL HTML specifically to avoid. Reproduced here offline, no network,
because they must never regress silently.

    python3 -m unittest test_html_text -v      (from ingest/)
"""
import unittest

from html_text import visible_text


class FiveDemonstratedBypasses(unittest.TestCase):
    """Each of these, against a bare `<[^>]+>` tag-stripper, let a phrase no
    reader ever sees survive into the "verifiable" text. None may survive
    here."""

    def test_an_unclosed_script_does_not_leak_its_content(self):
        # No closing </script> at all. HTML5 itself treats everything after
        # an unclosed <script> as script data, not as a parse error — a
        # stripper that requires seeing a closing tag to remove a block
        # leaves the "orphaned" tail sitting in the output as prose.
        self.assertEqual(visible_text("<script>QUOTE"), "")

    def test_a_template_block_does_not_leak_its_content(self):
        self.assertEqual(
            visible_text("<template>QUOTE</template>"), "")

    def test_a_hidden_element_does_not_leak_its_content(self):
        self.assertEqual(visible_text("<p hidden>QUOTE</p>"), "")

    def test_a_crafted_comment_does_not_leak_its_content(self):
        # The '>' right after "<!--" is not the comment's end — only the
        # real "-->" is. A tag-stripper applied before comments are removed
        # reads "<!-- >" as a whole "tag" and leaks " QUOTE -->" as text.
        self.assertEqual(visible_text("<!-- > QUOTE -->"), "")

    def test_a_quoted_attribute_containing_a_bare_gt_does_not_end_the_tag_early(self):
        # data-x's VALUE is the literal string '>QUOTE'. A regex that does
        # not track quote state reads the '>' inside the quotes as ending
        # the tag, and "QUOTE" leaks out as though it were page text
        # between two elements.
        self.assertEqual(
            visible_text('<div data-x=">QUOTE">visible</div>'), "visible")


class HidingSignals(unittest.TestCase):
    """The three explicit signals `visible_text` acts on, each checked in
    isolation, plus the shapes that must NOT be treated as hiding."""

    def test_boolean_hidden_attribute(self):
        self.assertEqual(visible_text("<div hidden>secret</div>visible"), "visible")

    def test_aria_hidden_true(self):
        self.assertEqual(
            visible_text('<span aria-hidden="true">secret</span>visible'), "visible")

    def test_aria_hidden_false_is_not_a_hiding_signal(self):
        self.assertEqual(
            visible_text('<span aria-hidden="false">shown</span>'), "shown")

    def test_inline_display_none(self):
        self.assertEqual(
            visible_text('<div style="display:none">secret</div>visible'), "visible")

    def test_inline_visibility_hidden(self):
        self.assertEqual(
            visible_text('<div style="visibility: hidden">secret</div>visible'),
            "visible")

    def test_display_none_survives_other_declarations_and_whitespace(self):
        self.assertEqual(
            visible_text(
                '<div style="color:red; display : none ; margin:0">secret</div>visible'),
            "visible")

    def test_display_block_is_not_display_none(self):
        # A style attribute merely mentioning "display" must not be treated
        # as a hiding signal on its own — only display:none/visibility:hidden.
        self.assertEqual(
            visible_text('<div style="display:block">shown</div>'), "shown")

    def test_a_class_named_hidden_is_not_the_hidden_attribute(self):
        # class="hidden" relies on an external stylesheet rule this module
        # does not execute — the declared limit in the module docstring.
        # Asserting the CURRENT (documented, not silently patched) behaviour:
        # such text is NOT detected as hidden and survives extraction.
        self.assertEqual(visible_text('<div class="hidden">shown</div>'), "shown")

    def test_nested_same_tag_hidden_container_is_removed_as_a_whole(self):
        # A non-nesting regex match (e.g. `<div hidden>.*?</div>`, non-greedy)
        # stops at the FIRST </div> it finds — which is the INNER div's
        # closer — and leaks whatever follows as though it were outside the
        # hidden container. A stack-based scan removes the whole thing.
        html_in = "<div hidden>outer <div>inner</div> more outer</div>after"
        self.assertEqual(visible_text(html_in), "after")


class ScriptStyleAndComments(unittest.TestCase):
    def test_style_blocks_are_removed_wholesale(self):
        self.assertEqual(
            visible_text("<style>.x{color:red}</style>Real text"), "Real text")

    def test_script_blocks_are_removed_wholesale(self):
        self.assertEqual(
            visible_text('<script>alert("x")</script>Real text'), "Real text")

    def test_ordinary_comments_are_removed(self):
        self.assertEqual(
            visible_text("<!-- an editor's note --> Real text"), "Real text")

    def test_multiple_comments_and_scripts_all_go(self):
        html_in = ("<!-- one -->Keep A<script>bad()</script>Keep B<!-- two -->"
                   "<style>x{}</style>Keep C")
        self.assertEqual(visible_text(html_in), "Keep AKeep BKeep C")


class OrdinaryStructure(unittest.TestCase):
    """Not a security property — just confirms the function is still usable
    as a text reducer, matching what `_wikisource_render_to_text` needed."""

    def test_entities_are_decoded(self):
        self.assertEqual(visible_text("<p>Cook &amp; crew</p>"), "Cook & crew")

    def test_zero_width_spaces_are_dropped(self):
        self.assertEqual(visible_text("<p>land​ at dawn</p>"), "land at dawn")

    def test_block_close_tags_become_paragraph_breaks(self):
        self.assertEqual(
            visible_text("<p>First.</p><p>Second.</p>"), "First.\n\nSecond.")

    def test_br_becomes_a_line_break(self):
        self.assertEqual(visible_text("Line one<br>Line two"), "Line one\nLine two")

    def test_a_bare_lt_in_prose_is_not_mistaken_for_a_tag(self):
        # The same regression `verbatim.py`'s module docstring warns about,
        # relocated here: a '<' not followed by a letter, '/', '!' or '?'
        # is not the start of markup and must not eat the rest of the line.
        book = "3 < 4 dinars, and we stayed"
        self.assertEqual(visible_text(book), book)

    def test_empty_input(self):
        self.assertEqual(visible_text(""), "")

    def test_plain_text_with_no_markup_at_all(self):
        self.assertEqual(visible_text("just plain words"), "just plain words")


if __name__ == "__main__":
    unittest.main()
