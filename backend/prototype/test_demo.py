import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
import wave

ROOT = Path(__file__).resolve().parent

class DemoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            cls.port = s.getsockname()[1]
        env = dict(os.environ, TTS_PROVIDER='mock')
        cls.proc = subprocess.Popen([sys.executable, 'server.py', '--port', str(cls.port)],
                                    cwd=ROOT, env=env, stdout=subprocess.DEVNULL)
        cls.base = f'http://127.0.0.1:{cls.port}'
        for _ in range(60):
            try:
                urllib.request.urlopen(cls.base + '/api/config', timeout=1).close()
                break
            except OSError:
                time.sleep(.05)
        else:
            cls.proc.terminate()
            raise RuntimeError('Server did not start')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)

    def call(self, path, payload=None, origin=None):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = origin
        req = urllib.request.Request(self.base + path,
                    data=None if payload is None else json.dumps(payload).encode(), headers=headers)
        try:
            r = urllib.request.urlopen(req, timeout=5)
        except urllib.error.HTTPError as e:
            r = e
        with r:
            data = r.read()
            return r.status, json.loads(data) if 'json' in r.headers.get('Content-Type', '') else data

    def test_complete_http_flow(self):
        text = '科技文章 <script>alert(1)</script> & 中文'
        code, job = self.call('/api/jobs', {'text': text, 'gender':'female', 'style':'calm', 'speed':'normal'})
        self.assertEqual(code, 202)
        self.assertEqual(job['status'], 'queued')
        for _ in range(100):
            code, result = self.call('/api/jobs/' + job['id'])
            if result['status'] in ['succeeded', 'failed']:
                break
            time.sleep(.01)
        self.assertEqual(result['status'], 'succeeded')
        self.assertEqual(result['input']['text'], text)
        self.assertIs(result['real_speech'], False)
        code, audio = self.call(result['audio_url'])
        self.assertEqual(code, 200)
        with wave.open(io.BytesIO(audio)) as f:
            self.assertEqual(f.getnframes(), 16000)
            self.assertEqual(f.getframerate(), 16000)

    def test_invalid_inputs_and_origin(self):
        for value in [None, [], {'text':' '}, {'text':'字'*501, 'gender':'male','style':'calm','speed':'normal'},
                      {'text':'abc','gender':'unknown','style':'calm','speed':'normal'}]:
            code, _ = self.call('/api/jobs', value if value is not None else [])
            self.assertEqual(code, 400)
        code, _ = self.call('/api/jobs', {}, 'https://example.invalid')
        self.assertEqual(code, 403)

    def test_unknown_and_path_traversal(self):
        for path in ['/api/jobs/'+'0'*32, '/api/jobs/'+'0'*32+'/audio', '/../../providers.py']:
            self.assertEqual(self.call(path)[0], 404)

    def test_missing_real_credentials(self):
        from unittest.mock import patch
        from providers import get_provider, ProviderError
        with patch.dict(os.environ, {'TTS_PROVIDER':'azure', 'AZURE_SPEECH_KEY':'', 'AZURE_SPEECH_REGION':''}):
            with self.assertRaises(ProviderError):
                get_provider()

if __name__ == '__main__':
    unittest.main(verbosity=2)
