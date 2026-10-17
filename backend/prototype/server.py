"""Run: python server.py; open http://127.0.0.1:8000. Python 3.10+, no pip."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import threading
import time
import uuid
from urllib.parse import urlsplit
from providers import ProviderError, get_provider

ROOT = Path(__file__).resolve().parent
JOBS = {}
LOCK = threading.Lock()
WORKER = ThreadPoolExecutor(max_workers=1)
MAX_TEXT = 500

def validate(payload):
    if not isinstance(payload, dict):
        raise ValueError('请求必须是 JSON 对象。')
    text = payload.get('text', '')
    if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
        raise ValueError(f'请输入1至{MAX_TEXT}个字符的正文，不能全为空白。')
    for key, allowed in [('gender', ['female', 'male']),
                         ('style', ['lively', 'calm']),
                         ('speed', ['slow', 'normal', 'fast'])]:
        if payload.get(key) not in allowed:
            raise ValueError(f'{key} 参数无效。')
    return {k: payload[k] for k in ['text', 'gender', 'style', 'speed']}

def public(job):
    return {k: v for k, v in job.items() if k != 'audio'}

def generate(job_id):
    with LOCK:
        job = JOBS[job_id]
        job['status'] = 'running'
    try:
        provider = get_provider()
        data, ext, mime = provider.synthesize(**job['input'])
        with LOCK:
            job.update(status='succeeded', audio=data, extension=ext, mime=mime,
                       real_speech=provider.real_speech,
                       audio_url=f'/api/jobs/{job_id}/audio')
    except ProviderError as e:
        with LOCK:
            job.update(status='failed', error=str(e))
    except Exception:
        with LOCK:
            job.update(status='failed', error='生成处理异常，请检查服务端配置。')

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Do not log document text, API keys or user-controlled query strings.
        pass

    def reply(self, code, content, mime='application/json; charset=utf-8', headers=None):
        if not isinstance(content, bytes):
            content = json.dumps(content, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/':
            return self.reply(200, (ROOT / 'index.html').read_bytes(), 'text/html; charset=utf-8')
        if path == '/api/config':
            try:
                p = get_provider()
                return self.reply(200, {'provider': p.name, 'real_speech': p.real_speech,
                                        'max_text': MAX_TEXT})
            except ProviderError as e:
                return self.reply(503, {'error': str(e)})
        match = re.fullmatch(r'/api/jobs/([0-9a-f]{32})(/audio)?', path)
        if not match:
            return self.reply(404, {'error': '不存在的接口。'})
        with LOCK:
            job = JOBS.get(match[1])
            if not job:
                return self.reply(404, {'error': '任务不存在，服务重启后记录会清空。'})
            snapshot = dict(job)
        if not match[2]:
            return self.reply(200, public(snapshot))
        if snapshot['status'] != 'succeeded':
            return self.reply(409, {'error': '音频尚未就绪。'})
        # In-memory bytes: the URL never becomes a user-selected file path.
        filename = f'tpg-{match[1]}.{snapshot["extension"]}'
        return self.reply(200, snapshot['audio'], snapshot['mime'],
                          {'Content-Disposition': f'attachment; filename="{filename}"'})

    def do_POST(self):
        if self.path != '/api/jobs':
            return self.reply(404, {'error': '不存在的接口。'})
        expected_host = f'127.0.0.1:{self.server.server_port}'
        if self.headers.get('Host') not in [expected_host, f'localhost:{self.server.server_port}']:
            return self.reply(403, {'error': '仅允许本机访问。'})
        origin = self.headers.get('Origin')
        if origin and origin not in [f'http://{expected_host}', f'http://localhost:{self.server.server_port}']:
            return self.reply(403, {'error': '来源不匹配。'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > 10000:
                raise ValueError('请求大小无效。')
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            inputs = validate(payload)
        except (ValueError, UnicodeError) as e:
            return self.reply(400, {'error': str(e) if not isinstance(e, json.JSONDecodeError) else 'JSON格式错误。'})
        with LOCK:
            if any(j['status'] in ['queued', 'running'] for j in JOBS.values()):
                return self.reply(429, {'error': '已有任务处理中，请稍后再试。'})
            if len(JOBS) >= 30:
                # Demo history stays bounded; only completed jobs can reach this point.
                del JOBS[next(iter(JOBS))]
            job_id = uuid.uuid4().hex
            job = {'id': job_id, 'status': 'queued', 'input': inputs,
                   'created_at': time.time(), 'error': None}
            JOBS[job_id] = job
            response = public(dict(job))
        self.reply(202, response)
        WORKER.submit(generate, job_id)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.daemon_threads = True
    print(f'Open http://127.0.0.1:{args.port} ; Ctrl+C to stop.', flush=True)
    print('Default mock mode generates a test tone, NOT speech.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        WORKER.shutdown(wait=True)

if __name__ == '__main__':
    main()
