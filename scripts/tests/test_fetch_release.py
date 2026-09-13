"""Parallel downloads must reconstruct exact bytes and reject invalid ranges."""

import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "fetch", Path(__file__).parents[1] / "fetch-release.py"
)
assert SPEC and SPEC.loader
fetch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fetch)


class Response(io.BytesIO):
    status = 206

    def __init__(self, data, content_range):
        super().__init__(data)
        self.headers = {"Content-Range": content_range}


class FetchTests(unittest.TestCase):
    def test_parallel_ranges_reconstruct_exact_archive(self):
        data = b"0123456789" * 250000

        def response(request, timeout):
            self.assertEqual(timeout, 60)
            self.assertNotIn("Authorization", request.headers)
            start, end = map(int, request.headers["Range"].removeprefix("bytes=").split("-"))
            return Response(data[start : end + 1], f"bytes {start}-{end}/{len(data)}")

        with (
            tempfile.TemporaryDirectory() as temp,
            patch.object(fetch.urllib.request, "urlopen", response),
        ):
            path = Path(temp) / "archive"
            fetch.download("https://example.com/signed", path, len(data))
            self.assertEqual(path.read_bytes(), data)

    def test_wrong_range_fails_after_bounded_retries(self):
        with (
            tempfile.TemporaryDirectory() as temp,
            patch.object(
                fetch.urllib.request,
                "urlopen",
                side_effect=lambda *a, **k: Response(b"wrong", "bytes 1-5/6"),
            ) as request,
            patch.object(fetch.time, "sleep"),
        ):
            with self.assertRaises(RuntimeError):
                fetch.download("https://example.com/signed", Path(temp) / "archive", 5)
            self.assertEqual(request.call_count, 4)

    def test_non_https_storage_rejected(self):
        with self.assertRaises(ValueError):
            fetch.download("file:///etc/passwd", Path("unused"), 1)


if __name__ == "__main__":
    unittest.main()
