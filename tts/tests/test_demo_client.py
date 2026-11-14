"""验证演示脚本实际产物及部分失败时不误报全量成功。无需监听 TCP。"""

from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from scripts.demo_tts_service import main
from tts_service.mock import MockEngine


class Response(io.BytesIO):
    @property
    def headers(self):
        class Headers:
            def get_content_type(self):
                return "audio/wav"
        return Headers()


class DemoTests(unittest.TestCase):
    def run_demo(self, folder, fail_second=False):
        class Opener:
            calls = 0

            def open(self, request, timeout):
                if isinstance(request, str):
                    return Response(b'{"engines":[]}')
                self.calls += 1
                if fail_second and self.calls == 2:
                    raise HTTPError(request.full_url, 503, "busy", {}, io.BytesIO(b'{"error":{"code":"engine_busy"}}'))
                payload = json.loads(request.data)
                voice = "tone_low" if payload["voice_id"] == "host_a" else "tone_high"
                return Response(MockEngine().synthesize(payload["text"], voice).wav_bytes)

        with patch("sys.argv", ["demo_tts_service.py", "--output-dir", str(folder)]), \
             patch("scripts.demo_tts_service.build_opener", return_value=Opener()), \
             redirect_stdout(io.StringIO()):
            main()

    def test_demo_writes_two_valid_outputs_and_metrics_without_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            self.run_demo(folder)
            self.run_demo(folder)
            runs = list(Path(folder).iterdir())
            self.assertEqual(len(runs), 2)
            for run in runs:
                report = json.loads((run / "metrics.json").read_text())
                self.assertEqual(len(report["results"]), 2)
                for result in report["results"]:
                    self.assertGreater(result["rtf"], 0)
                    self.assertEqual(result["duration_seconds"], 0.25)
                    self.assertEqual((run / result["file"]).read_bytes()[:4], b"RIFF")

    def test_partial_failure_keeps_successful_audio_without_success_report(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(SystemExit) as caught:
                self.run_demo(folder, fail_second=True)
            self.assertIn("engine_busy", str(caught.exception))
            run = next(Path(folder).iterdir())
            self.assertTrue((run / "000_host_a.wav").is_file())
            self.assertFalse((run / "metrics.json").exists())
            self.assertFalse((run / "001_host_b.wav").exists())
