"""Unit tests for pipeline.config's environment-driven defaults, and for
the link-store append/dedupe logic pushbullet_bridge.py relies on."""
import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))


class TestConfigDefaults(unittest.TestCase):
    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in
                      ("DAILY_DISPATCH_HOME", "DIGEST_API_URL", "DIGEST_API_KEY",
                       "LISTENER_NAME", "LISTENER_TOWN")}
        for k in self._saved:
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def _reload(self):
        if "config" in sys.modules:
            del sys.modules["config"]
        return importlib.import_module("config")

    def test_default_data_dir_under_home(self):
        config = self._reload()
        self.assertEqual(config.DATA_DIR, Path.home() / ".daily-dispatch")

    def test_env_override_moves_everything(self):
        os.environ["DAILY_DISPATCH_HOME"] = "/tmp/somewhere-else"
        config = self._reload()
        self.assertEqual(config.DATA_DIR, Path("/tmp/somewhere-else"))
        self.assertTrue(str(config.LINK_STORE).startswith("/tmp/somewhere-else"))

    def test_listener_identity_defaults_are_neutral(self):
        config = self._reload()
        self.assertEqual(config.LISTENER_NAME, "a listener")
        self.assertEqual(config.LISTENER_TOWN, "out there somewhere")

    def test_digest_api_conf_empty_when_unset(self):
        config = self._reload()
        self.assertEqual(config.digest_api_conf(), ("", ""))

    def test_digest_api_conf_reads_secrets_dir(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "api-url").write_text("https://example.invalid\n")
            (Path(d) / "api-key").write_text("secret-key\n")
            os.environ["DAILY_DISPATCH_SECRETS_DIR"] = d
            config = self._reload()
            self.assertEqual(config.digest_api_conf(), ("https://example.invalid", "secret-key"))
            del os.environ["DAILY_DISPATCH_SECRETS_DIR"]


class TestLinkStoreDedupe(unittest.TestCase):
    """The same dedupe-by-URL logic pushbullet_bridge.py uses before
    appending a link, exercised directly against a JSONL file."""

    def test_existing_urls_reads_jsonl(self):
        import pushbullet_bridge  # noqa: E402  (import after sys.path insert above)
        with tempfile.TemporaryDirectory() as d:
            store = Path(d) / "links.jsonl"
            store.write_text(
                json.dumps({"url": "https://a.example/1"}) + "\n" +
                json.dumps({"url": "https://b.example/2"}) + "\n"
            )
            pushbullet_bridge.LINK_STORE = str(store)
            urls = pushbullet_bridge._existing_urls()
        self.assertEqual(urls, {"https://a.example/1", "https://b.example/2"})

    def test_existing_urls_missing_file_returns_empty(self):
        import pushbullet_bridge  # noqa: E402
        pushbullet_bridge.LINK_STORE = "/tmp/does-not-exist-daily-dispatch-test.jsonl"
        self.assertEqual(pushbullet_bridge._existing_urls(), set())


class TestWebhookConfig(unittest.TestCase):
    """The optional link webhook is configured by LINK_WEBHOOK_URL and
    LINK_WEBHOOK_SECRET, read when the module loads."""

    def _reload_bridge(self, env):
        saved = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            sys.modules.pop("pushbullet_bridge", None)
            return importlib.import_module("pushbullet_bridge")
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
            sys.modules.pop("pushbullet_bridge", None)

    def test_reads_link_webhook_env_vars(self):
        bridge = self._reload_bridge({"LINK_WEBHOOK_URL": "https://hook.example/in",
                                      "LINK_WEBHOOK_SECRET": " s3cret "})
        self.assertEqual(bridge.WEBHOOK_URL, "https://hook.example/in")
        self.assertEqual(bridge.WEBHOOK_SECRET, "s3cret")


if __name__ == "__main__":
    unittest.main()
