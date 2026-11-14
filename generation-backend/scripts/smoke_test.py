"""用实际HTTP和独立Worker验证闭环。--start-local 会启动临时服务并在测试后关闭。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(base, method, path, body=None, key=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    if key:
        headers['Idempotency-Key'] = key
    request = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    with opener.open(request, timeout=10) as response:
        raw = response.read()
        return response.status, json.loads(raw) if 'application/json' in response.headers.get('Content-Type', '') else raw


def wait(base, tid, minimum_delay):
    deadline = time.monotonic() + 60
    begun = time.monotonic()
    while time.monotonic() < deadline:
        _, payload = call(base, 'GET', f'/api/v1/tasks/{tid}')
        task = payload['data']
        if task['status'] == 'failed':
            raise AssertionError(task)
        if task['status'] == 'succeeded':
            elapsed = time.monotonic() - begun
            assert elapsed >= minimum_delay, f'任务未按约定等待：{elapsed}'
            return task, elapsed
        # 生成期间 API 仍能响应，不会被 time.sleep 阻塞。
        t = time.monotonic()
        assert call(base, 'GET', '/api/v1/health/live')[0] == 200
        assert time.monotonic() - t < 2
        time.sleep(0.25)
    raise TimeoutError('任务未在60秒内完成；请确认Worker已启动')


def flow(base, output, minimum_delay=9.5):
    _, payload = call(base, 'POST', '/api/v1/projects', {'title': '真实HTTP闭环验证'})
    pid = payload['data']['project_id']
    call(base, 'PUT', f'/api/v1/projects/{pid}/source', {'text': '这是一份测试原文，用于验证后台框架；当前服务返回固定测试结果。'})
    _, payload = call(base, 'GET', '/api/v1/roles')
    role_id = payload['data']['items'][0]['profile_id']
    started = time.monotonic()
    status, payload = call(base, 'POST', f'/api/v1/projects/{pid}/script/generate',
        {'roles': [{'profile_id': role_id, 'role_key': 'host'}]}, 'script-' + str(uuid4()))
    script_accept_seconds = time.monotonic() - started
    assert status == 202 and script_accept_seconds < 2
    script_task, script_seconds = wait(base, payload['data']['task_id'], minimum_delay)
    sid = script_task['result']['script_id']
    _, payload = call(base, 'GET', f'/api/v1/scripts/{sid}')
    script = payload['data']
    assert [s['sequence'] for s in script['sentences']] == list(range(1, len(script['sentences']) + 1))
    confirmation = {'expected_script_version': script['version'], 'expected_edit_revision': script['edit_revision']}
    call(base, 'POST', f'/api/v1/scripts/{sid}/confirm', confirmation)
    started = time.monotonic()
    status, payload = call(base, 'POST', f'/api/v1/projects/{pid}/audio/generate',
        {'script_id': sid, **confirmation}, 'audio-' + str(uuid4()))
    audio_accept_seconds = time.monotonic() - started
    assert status == 202 and audio_accept_seconds < 2
    audio_task, audio_seconds = wait(base, payload['data']['task_id'], minimum_delay)
    _, audio = call(base, 'GET', audio_task['result']['download_url'])
    assert audio == (ROOT / 'fixtures' / 'test_audio.mp3').read_bytes()
    output.mkdir(parents=True, exist_ok=True)
    (output / 'script.json').write_text(json.dumps(script, ensure_ascii=False, indent=2), encoding='utf-8')
    (output / 'audio.mp3').write_bytes(audio)
    report = {'project_id': pid, 'script_id': sid, 'audio_asset_id': audio_task['result']['asset_id'],
              'script_accept_seconds': round(script_accept_seconds, 3), 'script_wait_seconds': round(script_seconds, 3),
              'audio_accept_seconds': round(audio_accept_seconds, 3), 'audio_wait_seconds': round(audio_seconds, 3),
              'audio_bytes': len(audio), 'sha256': hashlib.sha256(audio).hexdigest(),
              'simulated': True, 'real_speech': False}
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:8000')
    parser.add_argument('--start-local', action='store_true', help='启动隔离的API、Worker和临时数据库')
    parser.add_argument('--output', type=Path, default=ROOT / 'data' / 'smoke-result')
    args = parser.parse_args()
    if not args.start_local:
        flow(args.base_url.rstrip('/'), args.output)
        return
    with tempfile.TemporaryDirectory(prefix='textcast-smoke-') as folder:
        folder = Path(folder)
        env = {**os.environ, 'DATABASE_URL': f'sqlite:///{(folder / "db.sqlite3").as_posix()}',
               'STORAGE_DIR': str(folder / 'assets'), 'PYTHONUTF8': '1'}
        subprocess.run([sys.executable, '-m', 'app.bootstrap'], cwd=ROOT, env=env, check=True)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        children = []
        flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        with (folder / 'api.log').open('w', encoding='utf-8') as api_log, (folder / 'worker.log').open('w', encoding='utf-8') as worker_log:
            try:
                children.append(subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(port)],
                    cwd=ROOT, env=env, stdout=api_log, stderr=subprocess.STDOUT, creationflags=flags))
                children.append(subprocess.Popen([sys.executable, '-m', 'app.worker'], cwd=ROOT, env=env,
                    stdout=worker_log, stderr=subprocess.STDOUT, creationflags=flags))
                for _ in range(100):
                    try:
                        if call(base, 'GET', '/api/v1/health/ready')[0] == 200:
                            break
                    except (urllib.error.URLError, OSError):
                        time.sleep(0.1)
                else:
                    raise RuntimeError('API启动失败')
                flow(base, args.output)
            except BaseException:
                args.output.mkdir(parents=True, exist_ok=True)
                api_log.flush(); worker_log.flush()
                (args.output / 'api.log').write_bytes((folder / 'api.log').read_bytes())
                (args.output / 'worker.log').write_bytes((folder / 'worker.log').read_bytes())
                raise
            finally:
                for child in children:
                    if child.poll() is None:
                        if os.name == 'nt':
                            # Windows venv 的 python.exe 可能是启动器，需要一起关闭其子进程。
                            subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'],
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                        else:
                            child.terminate()
                for child in children:
                    try:
                        child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        child.kill(); child.wait(timeout=5)


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()
