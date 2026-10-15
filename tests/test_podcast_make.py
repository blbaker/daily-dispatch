"""Unit tests for pipeline.podcast_make's script parser (pure functions,
no network calls)."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import podcast_make  # noqa: E402


class TestParse(unittest.TestCase):
    def _write(self, d, name, lines):
        path = os.path.join(d, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        return path

    def test_parses_segments_and_lines(self):
        voices = {"S1": {"id": "x", "name": "Host 1"}, "S2": {"id": "y", "name": "Host 2"}}
        with tempfile.TemporaryDirectory() as d:
            self._write(d, "01-open.txt", [
                "## Open",
                "S1: Hello there.",
                "S2: [laughing] My brother again.",
            ])
            segs = podcast_make.parse(d, voices)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0]["title"], "Open")
        self.assertEqual(segs[0]["lines"], [
            ("S1", "Hello there."),
            ("S2", "[laughing] My brother again."),
        ])

    def test_multiple_files_read_in_name_order(self):
        voices = {"S1": {"id": "x", "name": "Host 1"}}
        with tempfile.TemporaryDirectory() as d:
            self._write(d, "02-close.txt", ["## Close", "S1: Bye."])
            self._write(d, "01-open.txt", ["## Open", "S1: Hi."])
            segs = podcast_make.parse(d, voices)
        self.assertEqual([s["title"] for s in segs], ["Open", "Close"])

    def test_unknown_tag_rejected(self):
        voices = {"S1": {"id": "x", "name": "Host 1"}}
        with tempfile.TemporaryDirectory() as d:
            self._write(d, "01.txt", ["## Open", "S9: Who is this?"])
            with self.assertRaises(SystemExit):
                podcast_make.parse(d, voices)

    def test_tag_only_line_rejected(self):
        voices = {"S1": {"id": "x", "name": "Host 1"}}
        with tempfile.TemporaryDirectory() as d:
            self._write(d, "01.txt", ["## Open", "S1: [laughs]"])
            with self.assertRaises(SystemExit):
                podcast_make.parse(d, voices)

    def test_line_before_any_segment_header_gets_intro(self):
        voices = {"S1": {"id": "x", "name": "Host 1"}}
        with tempfile.TemporaryDirectory() as d:
            self._write(d, "01.txt", ["S1: No heading yet."])
            segs = podcast_make.parse(d, voices)
        self.assertEqual(segs[0]["title"], "Intro")


class TestChunk(unittest.TestCase):
    def test_splits_on_max_chars(self):
        segs = [{"lines": [("S1", "a" * 50), ("S1", "b" * 60)]}]
        chunks = podcast_make.chunk(segs, max_chars=80)
        self.assertEqual(len(chunks), 2)
        # both chunks belong to the same (only) segment, so only the final
        # chunk overall marks the end of that segment
        self.assertFalse(chunks[0]["last_in_seg"])
        self.assertTrue(chunks[1]["last_in_seg"])

    def test_keeps_short_segment_in_one_chunk(self):
        segs = [{"lines": [("S1", "short"), ("S2", "also short")]}]
        chunks = podcast_make.chunk(segs, max_chars=1900)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(len(chunks[0]["lines"]), 2)

    def test_last_in_seg_flag_across_segments(self):
        segs = [
            {"lines": [("S1", "seg one")]},
            {"lines": [("S1", "seg two")]},
        ]
        chunks = podcast_make.chunk(segs, max_chars=1900)
        self.assertEqual(len(chunks), 2)
        self.assertTrue(all(c["last_in_seg"] for c in chunks))


class TestTranscript(unittest.TestCase):
    def test_strips_audio_tags_and_names_speakers(self):
        voices = {"S1": {"id": "x", "name": "Host One"}}
        segs = [{"title": "Open", "lines": [("S1", "[laughing] Hello there.")]}]
        out = podcast_make.transcript(segs, voices, "Test Show")
        self.assertIn("# Test Show", out)
        self.assertIn("## Open", out)
        self.assertIn("**Host One:** Hello there.", out)
        self.assertNotIn("[laughing]", out)


if __name__ == "__main__":
    unittest.main()
