"""Unit tests for the archive app's keyword-based story categories."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import categories  # noqa: E402


class TestInferCategory(unittest.TestCase):
    def test_sports_keywords(self):
        self.assertEqual(categories.infer_category("Coach explains the playoff loss"), "sports")

    def test_first_matching_rule_wins(self):
        # "github" (tech) is checked before "season" (sports)
        self.assertEqual(categories.infer_category("GitHub ships a new season of updates"), "tech")

    def test_unmatched_text_defaults_to_tech(self):
        self.assertEqual(categories.infer_category("A quiet afternoon"), "tech")

    def test_every_rule_has_a_label_and_colour(self):
        for cat, _ in categories.CAT_RULES:
            self.assertIn(cat, categories.CAT_LABEL)
            self.assertIn(cat, categories.CATS)


if __name__ == "__main__":
    unittest.main()
