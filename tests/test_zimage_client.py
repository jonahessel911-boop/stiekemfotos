import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from gradio_client.exceptions import AppError

from scripts import zimage_client as mod


class ZImageUnitTests(unittest.TestCase):
    def test_extract_first_image_path_all_supported_shapes(self):
        helper = mod.ZImageClient._extract_first_image_path
        self.assertEqual(
            str(helper([{"image": "/tmp/a.png", "caption": None}])),
            "/tmp/a.png",
        )
        self.assertEqual(
            str(helper([{"image": {"path": "/tmp/b.png", "url": "https://x/y.png"}, "caption": None}])),
            "/tmp/b.png",
        )
        self.assertEqual(
            str(helper([("/tmp/c.png", None)])),
            "/tmp/c.png",
        )
        self.assertEqual(
            str(helper(["/tmp/d.png"])),
            "/tmp/d.png",
        )

    def test_extract_first_image_path_invalid_shape_raises_with_repr(self):
        helper = mod.ZImageClient._extract_first_image_path
        with self.assertRaises(RuntimeError) as cm:
            helper([{"image": 123}])
        msg = str(cm.exception)
        self.assertIn("type=dict", msg)
        self.assertIn("{'image': 123}", msg)

    def test_invalid_resolution_rejected_before_network(self):
        c = mod.ZImageClient(hf_token="dummy")
        with patch.object(c, "_get_client", side_effect=AssertionError("network should not be called")):
            with self.assertRaises(ValueError):
                c.generate("hello", resolution="123x123 ( 1:1 )")

    def test_nsfw_placeholder_hash_detection(self):
        data = b"placeholder-bytes"
        expected = __import__("hashlib").sha256(data).hexdigest()
        with patch.object(mod, "NSFW_PLACEHOLDER_SHA256", expected):
            self.assertTrue(mod.is_nsfw_placeholder(data))
        with patch.object(mod, "NSFW_PLACEHOLDER_SHA256", "deadbeef"):
            self.assertFalse(mod.is_nsfw_placeholder(data))

    def test_quota_error_is_raised_from_apperror(self):
        c = mod.ZImageClient(hf_token="dummy")
        fake_client = MagicMock()
        fake_client.predict.side_effect = AppError("ZeroGPU quota exceeded — please wait")
        with patch.object(c, "_get_client", return_value=fake_client):
            with self.assertRaises(mod.QuotaExceededError):
                c.generate("hello")

    def test_retry_backoff_uses_60_120(self):
        c = mod.ZImageClient(hf_token="dummy")
        attempts = {"n": 0}

        def fake_generate(*args, **kwargs):
            attempts["n"] += 1
            raise mod.QuotaExceededError("quota exceeded")

        with patch.object(c, "generate", side_effect=fake_generate), patch("time.sleep") as sleep_mock:
            result = c.generate_with_retry("hello", max_attempts=3, backoff_base_s=60.0)
            self.assertEqual(result.status, "failed")
            self.assertEqual(result.image_path, None)
            self.assertEqual(attempts["n"], 3)
            sleep_mock.assert_any_call(60.0)
            sleep_mock.assert_any_call(120.0)
            self.assertEqual(sleep_mock.call_count, 2)


@unittest.skipUnless(os.environ.get("HF_TOKEN"), "HF_TOKEN not configured; skipping live integration test")
class ZImageIntegrationTests(unittest.TestCase):
    def test_live_roundtrip_returns_png(self):
        client = mod.ZImageClient()
        with tempfile.TemporaryDirectory() as tmpdir:
            result = client.generate_with_retry(
                "a photograph of a snow leopard on a Himalayan ridge at golden hour",
                resolution="1024x1024 ( 1:1 )",
                random_seed=True,
                output_dir=tmpdir,
                max_attempts=1,
            )
            self.assertEqual(result.status, "success")
            self.assertIsNotNone(result.image_path)
            p = Path(result.image_path)
            self.assertTrue(p.exists())
            sig = p.read_bytes()[:8]
            self.assertEqual(sig, b"\x89PNG\r\n\x1a\n")


if __name__ == "__main__":
    unittest.main()

