"""Supervisor and HTTP trust-boundary regression tests (no model dependencies)."""
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, ProxyHandler, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import local_console as console
import local_tasks as tasks


class ConsoleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.patches = [patch.object(console, "DATA", self.folder), patch.object(tasks, "DATA", self.folder)]
        for p in self.patches:
            p.start()
        self.control = console.Console()

    def tearDown(self):
        self.control.stop()
        for p in self.patches:
            p.stop()
        self.temp.cleanup()

    def test_isolated_runs_and_shared_config(self):
        first, config = tasks.prepare("mock")
        second, _ = tasks.prepare("http-mock")
        self.assertNotEqual(first, second)
        self.assertIn(str(first), config["env"]["DATABASE_URL"])
        self.assertEqual(config["env"]["TEXTCAST_AUTH_URL"], "http://127.0.0.1:8000")
        self.assertEqual(config["env"]["VITE_ENABLE_MOCK"], "false")
        self.assertEqual(config["env"]["AUDIO_PROVIDER"], "mock")
        if os.name != "nt":
            self.assertEqual((first / "config.json").stat().st_mode & 0o777, 0o600)

    def test_task_allowlist_and_requires_services(self):
        for name in ("echo secret", "flow", "health"):
            with self.assertRaises(ValueError):
                self.control.task(name)

    def test_restart_reuses_current_data_and_mode(self):
        folder, config = tasks.prepare("mock")
        self.control.folder, self.control.config = folder, config
        with patch.object(self.control, "stop") as stop, patch.object(self.control, "start", return_value="restart-job") as start:
            self.assertEqual(self.control.restart(), "restart-job")
        stop.assert_called_once()
        start.assert_called_once_with("mock", resume=folder)

    def test_service_definitions_split_script_and_audio_workers(self):
        definitions = {name: (module, args) for name, module, args in console.service_definitions("customvoice")}
        self.assertEqual(definitions["worker-script"],
                         ("generation-backend", ["-m", "app.worker", "--queue", "script"]))
        self.assertEqual(definitions["worker-audio"],
                         ("generation-backend", ["-m", "app.worker", "--queue", "audio"]))
        self.assertIn("tts", definitions)
        self.assertIn("llm", definitions)

    def test_resume_rejects_external_directories(self):
        with self.assertRaisesRegex(ValueError, "隔离测试目录"), patch.object(console.socket.socket, "bind"):
            self.control.start("mock", resume=self.folder.parent)

    def test_cancel_and_nonzero_exit(self):
        env = {**os.environ}
        item = self.control.job("test", [sys.executable, "-u", "-c", "import time;print('ready');time.sleep(60)"], self.folder, env)
        with self.assertRaises(ValueError):
            self.control.task("preflight")
        self.control.stop()
        self.assertIsNotNone(item["process"].poll())
        self.assertEqual(self.control.snapshot()["jobs"][0]["status"], "cancelled")
        failed = self.control.job("test", [sys.executable, "-c", "raise SystemExit(7)"], self.folder, env)
        failed["process"].wait(timeout=5)
        self.assertEqual(self.control.snapshot()["jobs"][0]["status"], "failed")
        self.assertEqual(self.control.snapshot()["jobs"][0]["exit_code"], 7)

    def test_live_output_is_readable_before_subprocess_exit(self):
        import time
        item = self.control.job("test", [sys.executable, "-c", "import time; print('live-output'); time.sleep(30)"],
                                self.folder, {**os.environ, "PYTHONUNBUFFERED": "0"})
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and "live-output" not in self.control.log(item["id"]):
            time.sleep(0.05)
        self.assertIn("live-output", self.control.log(item["id"]))
        self.assertIsNone(item["process"].poll())

    def test_hardware_detection_is_nonblocking_and_cached(self):
        started, release = threading.Event(), threading.Event()
        def collect(*_args):
            started.set()
            release.wait(timeout=3)
            return {"cpu": {"name": "test"}}
        with patch.object(console, "collect_hardware", side_effect=collect) as probe:
            self.assertEqual(self.control.hardware()["status"], "detecting")
            self.assertTrue(started.wait(timeout=1))
            self.assertEqual(self.control.hardware(refresh=True)["status"], "detecting")
            release.set()
            import time
            for _ in range(100):
                if not self.control.hardware_detecting: break
                time.sleep(0.01)
            self.assertEqual(self.control.hardware(refresh=True)["status"], "ready")
            probe.assert_called_once()

    def test_settings_validation(self):
        for values in ({"PATH": "/tmp"}, {"LLM_DEVICE": "shell"}, {"PODCAST_LLM_PYTHON": "relative"}, {"LLM_DEVICE": []}):
            with self.assertRaises(ValueError):
                self.control.settings(values)
        self.control.settings({"TTS_MODEL_SIZE": "", "TTS_QWEN_BACKEND": ""})
        self.assertEqual(tasks.options()["TTS_QWEN_BACKEND"], "standard")
        self.control.settings({"LLM_DEVICE": "cpu"})
        self.assertEqual(tasks.options(), {"LLM_DEVICE": "cpu"})

    def test_start_failure_reclaims_started_services(self):
        folder, config = tasks.prepare("mock")
        self.control.folder, self.control.config = folder, config
        job = self.control.job("bootstrap", [sys.executable, "-c", "pass"], folder, os.environ.copy())
        job["process"].wait(timeout=5)
        original = self.control.service

        def sleeping_service(name, command, cwd, env, run_folder):
            original(name, [sys.executable, "-c", "import time;time.sleep(60)"], folder, env, run_folder)

        with patch.object(self.control, "service", side_effect=sleeping_service), patch.object(console, "pnpm", side_effect=RuntimeError("missing pnpm")):
            self.control.finish_start(job, folder, config, os.environ.copy())
        self.assertEqual(self.control.snapshot()["jobs"][0]["status"], "failed")
        self.assertFalse(job["starting"])
        self.assertTrue(self.control.services)
        self.assertTrue(all(s["process"].poll() is not None for s in self.control.services.values()))
        self.assertIn("missing pnpm", self.control.log(job["id"]))

    def test_http_origin_token_host_and_artifact_boundaries(self):
        server = console.ThreadingHTTPServer(("127.0.0.1", 0), console.Handler)
        server.console, server.token = self.control, secrets.token_urlsafe(32)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        opener = build_opener(ProxyHandler({}))

        def request(path, body=None, headers=None):
            req = Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers or {})
            try:
                with opener.open(req, timeout=5) as response:
                    return response.status, response.read()
            except HTTPError as exc:
                return exc.code, exc.read()

        try:
            self.assertEqual(request("/api/state")[0], 200)
            with patch.object(self.control, "hardware", return_value={"status": "ready", "report": {"cpu": "test"}}):
                self.assertEqual(json.loads(request("/api/hardware")[1])["status"], "ready")
            self.assertEqual(request("/", headers={"Host": "attacker.example"})[0], 403)
            self.assertEqual(request("/api/stop", {})[0], 403)
            self.assertEqual(request("/api/stop", {}, {"Origin": "http://evil.example", "X-Console-Token": server.token})[0], 403)
            valid = {"Origin": base, "X-Console-Token": server.token}
            self.assertEqual(request("/api/task", {"action": "arbitrary"}, valid)[0], 400)
            self.assertEqual(request("/api/stop", {}, valid)[0], 202)
            self.assertEqual(request("/artifacts/%2e%2e/settings.json")[0], 403)
            self.assertEqual(request("/artifacts/run/config.json")[0], 403)
            result = self.folder / "run/results"
            result.mkdir(parents=True)
            (result / "report.json").write_text('{"passed": true}')
            self.assertEqual(json.loads(request("/artifacts/run/results/report.json")[1]), {"passed": True})
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
