from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

from scripts import prepare_source_archive as archive_tool
from scripts.verify_backend_flow import run_flow, wait_task


class DeliveryToolsTests(unittest.TestCase):
    def test_source_archive_excludes_local_assets_and_symlinked_files(self):
        with tempfile.TemporaryDirectory() as source, tempfile.TemporaryDirectory() as destination:
            root = Path(source)
            contents = {"README.md": "source", "scripts/example.py": "print(1)",
                        "scripts/.env": "secret", "scripts/private.key": "key", "scripts/user.wav": "audio",
                        "scripts/data/private.txt": "userdata", "scripts/.venv/lib/local.py": "env",
                        "llm/llm_service/app.py": "source", "llm/models/config.json": "model",
                        "llm/.cache/token.json": "cache", "llm/.venv/lib/local.py": "env",
                        "backend/.env.example": "AUDIO_PROVIDER=mock", "docs/guide.md": "guide"}
            for name, content in contents.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content)
            (root / "tts/data").mkdir(parents=True)
            (root / "tts/data/texts").symlink_to(Path(destination), target_is_directory=True)
            (Path(destination) / "example.txt").write_text("outside source root")
            with patch.object(archive_tool, "ROOT", root), \
                 patch("sys.argv", ["prepare_source_archive.py", "--output-dir", destination]), \
                 redirect_stdout(io.StringIO()):
                archive_tool.main()
            folder = next(path for path in Path(destination).iterdir() if path.is_dir())
            with zipfile.ZipFile(folder / "podcast-source.zip") as archive:
                self.assertEqual(set(archive.namelist()), {"README.md", "scripts/example.py",
                                                         "backend/.env.example", "docs/guide.md", "llm/llm_service/app.py"})
            manifest = json.loads((folder / "manifest.json").read_text())
            self.assertEqual(len(manifest["files"]), 5)
            self.assertTrue(all(len(item["sha256"]) == 64 for item in manifest["files"]))

    def test_backend_flow_reads_real_ids_and_revision_before_submitting(self):
        class FakeBackend:
            def __init__(self):
                self.calls = []
            def request(self, path, body=None, method="GET", key=None, binary=False):
                self.calls.append((path, body, method, key))
                if path.endswith("/health/live"):
                    return {"status": "ok"}
                if path.endswith("/health/ready"):
                    return {"provider": "local_http"}
                if "/roles?" in path:
                    return {"total": 2, "items": [
                        {"profile_id": 41, "tts_provider": "local_http", "tts_model": "mock", "voice_id": "host_a"},
                        {"profile_id": 99, "tts_provider": "local_http", "tts_model": "mock", "voice_id": "host_b"}]}
                if path == "/api/v1/projects":
                    return {"project_id": 12}
                if path.endswith("/script/generate"):
                    return {"task_id": 51}
                if path.endswith("/tasks/51"):
                    return {"status": "succeeded", "result": {"script_id": 87}}
                if path.endswith("/scripts/87"):
                    return {"script_id": 87, "version": 3, "edit_revision": 9, "title": "太阳系",
                        "roles": [{"role_id": 11, "name": "主持人甲"}],
                        "sentences": [{"sequence": 1, "role_id": 11, "text": "欢迎了解太阳系。"}]}
                if path.endswith("/audio/generate"):
                    return {"task_id": 52}
                if path.endswith("/tasks/52"):
                    return {"status": "succeeded", "result": {"asset_id": 61, "download_url": "/api/v1/audio-assets/61/download"}}
                return b"ID3test" if binary else {}
        client = FakeBackend()
        context = {}
        self.assertEqual(run_flow(client, "mock", 5, context), b"ID3test")
        self.assertEqual(context["project_id"], 12)
        confirm = next(call for call in client.calls if call[0].endswith("/confirm"))
        self.assertEqual(confirm[1], {"expected_script_version": 3, "expected_edit_revision": 9})
        script = next(call for call in client.calls if call[0].endswith("/script/generate"))
        self.assertEqual([role["profile_id"] for role in script[1]["roles"]], [41, 99])
        audio = next(call for call in client.calls if call[0].endswith("/audio/generate"))
        self.assertEqual(audio[1]["script_id"], 87)
        self.assertNotEqual(script[3], audio[3])
        class AudioFailure(FakeBackend):
            def request(self, path, *args, **kwargs):
                if path.endswith("/audio/generate"):
                    raise RuntimeError("音频提交失败")
                return super().request(path, *args, **kwargs)
        with tempfile.TemporaryDirectory() as folder:
            context = {}
            with self.assertRaisesRegex(RuntimeError, "音频提交失败"):
                run_flow(AudioFailure(), "mock", 5, context, output_dir=folder)
            saved = json.loads((Path(folder) / "script.json").read_text(encoding="utf-8"))
            self.assertEqual((saved["script_id"], saved["version"], saved["edit_revision"]), (87, 3, 9))
            text = (Path(folder) / "script.txt").read_text(encoding="utf-8")
            self.assertIn("主持人甲", text)
            self.assertIn("欢迎了解太阳系。", text)
            self.assertEqual(context["script_file"], "script.json")

    def test_failed_task_is_not_reported_as_success(self):
        client = Mock()
        client.request.return_value = {"status": "failed", "error_code": "TTS_ENGINE_BUSY", "error_message": "busy"}
        with self.assertRaisesRegex(RuntimeError, "TTS_ENGINE_BUSY"):
            wait_task(client, 42, 5)

    def test_task_timeout_is_distinct_from_cancellation(self):
        client = Mock()
        client.request.return_value = {"status": "queued"}
        with patch("scripts.verify_backend_flow.time.monotonic", side_effect=[0, 2]):
            with self.assertRaisesRegex(TimeoutError, "未被取消"):
                wait_task(client, 42, 1)

    def test_real_qwen_flow_requires_real_script_and_audio_metadata(self):
        class QwenBackend:
            def __init__(self, script_simulated=False, audio_simulated=False, configured_engine="qwen3-customvoice"):
                self.script_simulated, self.audio_simulated = script_simulated, audio_simulated
                self.configured_engine, self.downloaded, self.created = configured_engine, False, False

            def request(self, path, body=None, method="GET", key=None, binary=False):
                if path.endswith("/health/live"):
                    return {"status": "ok"}
                if path.endswith("/health/ready"):
                    return {"provider": "local_http", "llm_provider": "local_http", "tts_engine_id": self.configured_engine}
                if "/roles?" in path:
                    return {"total": 2, "items": [{"profile_id": i, "tts_provider": "local_http",
                        "tts_model": "qwen3-customvoice", "voice_id": alias} for i, alias in enumerate(("host_a", "host_b"), 1)]}
                if path == "/api/v1/projects":
                    self.created = True
                    return {"project_id": 1}
                if path.endswith("/script/generate"):
                    return {"task_id": 1}
                if path.endswith("/tasks/1"):
                    return {"status": "succeeded", "result": {"script_id": 1, "generation": {
                        "provider": "local_http", "model_id": "Qwen/Qwen2.5-0.5B-Instruct", "simulated": self.script_simulated}}}
                if path.endswith("/scripts/1"):
                    return {"script_id": 1, "version": 2, "edit_revision": 3}
                if path.endswith("/audio/generate"):
                    return {"task_id": 2}
                if path.endswith("/tasks/2"):
                    return {"status": "succeeded", "result": {"asset_id": 1, "download_url": "/api/v1/audio-assets/1/download",
                        "metadata": {"engine_id": "qwen3-customvoice", "simulated": self.audio_simulated,
                            "real_speech": not self.audio_simulated, "script_simulated": self.script_simulated}}}
                if binary:
                    self.downloaded = True
                    return b"ID3test"
                return {}

        good = QwenBackend()
        self.assertEqual(run_flow(good, "qwen3-customvoice", 5, {}, require_real=True), b"ID3test")
        for backend in (QwenBackend(script_simulated=True), QwenBackend(audio_simulated=True),
                        QwenBackend(configured_engine="mock")):
            with self.assertRaises(RuntimeError):
                run_flow(backend, "qwen3-customvoice", 5, {}, require_real=True)
            self.assertFalse(backend.downloaded)
            if backend.configured_engine == "mock":
                self.assertFalse(backend.created)
