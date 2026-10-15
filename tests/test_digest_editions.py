"""Unit tests for pipeline.digest_editions' pure HTML/JSONL parsers."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import digest_editions  # noqa: E402


class TestOverviewFromHtml(unittest.TestCase):
    def test_extracts_labeled_bullets(self):
        block = (
            '<div class="overview"><ul>'
            '<li><strong>Why it matters:</strong> It matters a lot.</li>'
            '<li><strong>By the numbers:</strong> Three times as many.</li>'
            '</ul></div>'
        )
        out = digest_editions.overview_from_html(block)
        self.assertEqual(out, [
            {"label": "Why it matters", "text": "It matters a lot."},
            {"label": "By the numbers", "text": "Three times as many."},
        ])

    def test_no_overview_div_returns_empty(self):
        self.assertEqual(digest_editions.overview_from_html("<p>no box here</p>"), [])

    def test_unlabeled_bullet_keeps_text_with_empty_label(self):
        block = '<div class="overview"><ul><li>just text</li></ul></div>'
        out = digest_editions.overview_from_html(block)
        self.assertEqual(out, [{"label": "", "text": "just text"}])


class TestParseFinished(unittest.TestCase):
    def test_returns_none_for_non_matching_filename(self):
        class FakePath:
            name = "not-a-digest.html"
        self.assertIsNone(digest_editions.parse_finished(FakePath(), lambda *a, **k: {}, lambda t: "tech"))

    def test_parses_one_article(self):
        class FakePath:
            name = "link_digest_20260101.html"
            def read_text(self, encoding=None, errors=None):
                return (
                    '<h2>A real headline</h2>'
                    '<p><em>Example Source</em></p>'
                    '<div class="artdate">Published January 1, 2026</div>'
                    '<div class="overview"><ul><li><strong>Why it matters:</strong> Reasons.</li></ul></div>'
                    '<p>First paragraph of the story.</p>'
                    '<div class="source"><a href="https://example.com/a">https://example.com/a</a></div>'
                )
        got = digest_editions.parse_finished(FakePath(), lambda *a, **k: {}, lambda t: "tech")
        self.assertIsNotNone(got)
        day, stories = got
        self.assertEqual(day.strftime("%Y-%m-%d"), "2026-01-01")
        self.assertEqual(len(stories), 1)
        self.assertEqual(stories[0]["headline"], "A real headline")
        self.assertEqual(stories[0]["url"], "https://example.com/a")
        self.assertEqual(stories[0]["summary"], ["First paragraph of the story."])
        self.assertEqual(stories[0]["overview"], [{"label": "Why it matters", "text": "Reasons."}])


if __name__ == "__main__":
    unittest.main()
