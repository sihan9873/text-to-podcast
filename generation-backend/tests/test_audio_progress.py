import io
import wave
import logging

from app.integrations.local_tts import LocalTTSAudioGenerator, audio_config
from app.core.config import Settings
from app.jobs import repository
from test_framework import env, create_project, generate_script, submit_audio


def test_chunk_progress_tracks_completed_sentences_and_logs_without_text(caplog):
    updates = []
    config = audio_config(Settings(audio_provider='local_http', tts_engine_id='mock', tts_chunk_chars=4))
    generator = LocalTTSAudioGenerator(config, on_progress=lambda *args: updates.append(args))
    audio = io.BytesIO()
    with wave.open(audio, 'wb') as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000)
        output.writeframes(b'\0\0' * 240)

    def upstream(path, payload=None, audio=False):
        if path == '/v1/engines':
            return {'engines': [{'engine_id': 'mock', 'installed': True, 'max_text_length': 4, 'supports_speed': False}]}
        if path.startswith('/v1/voices'):
            return {'voices': ['host_a']}
        return wav

    wav = audio.getvalue()
    generator._request = upstream
    generator._ffmpeg = lambda _args, _data: b'\0\0' * 240
    snapshot = {'script': {'roles': [{'role_id': 1, 'voice_config': {'tts_provider': 'local_http', 'tts_model': 'mock', 'voice_id': 'host_a'}}],
        'sentences': [{'role_id': 1, 'sequence': i+1, 'text': text} for i, text in enumerate(['私密台词一二三四', '第二句'])]}}
    with caplog.at_level(logging.INFO):
        generator.generate(snapshot)
    assert updates == [('synthesizing', 5, 0), ('synthesizing', 33, 0), ('synthesizing', 62, 1),
                       ('synthesizing', 90, 2), ('encoding_audio', 95, 2)]
    assert 'Audio chunk started: chunk=1/3' in caplog.text
    assert 'Audio chunk completed: chunk=3/3' in caplog.text
    assert '私密台词' not in caplog.text


def test_running_audio_progress_is_visible_in_task_and_version(env):
    pid = create_project(env)
    sid = generate_script(env, pid, confirm=True)
    accepted = submit_audio(env, pid, sid).json()['data']
    job = repository.claim(env.db, env.settings)
    assert repository.progress(env.db, job['id'], job['token'], 'synthesizing', 55, 2)
    task = env.client.get(f"/api/v1/tasks/{accepted['task_id']}").json()['data']
    assert task['status'] == 'running' and task['progress'] == 55 and task['completed_sentences'] == 2
    view = env.client.get(f"/api/v1/audio-versions/{accepted['audio_version_id']}/sentences").json()['data']
    assert view['completed_sentences'] == 2 and view['total_sentences'] == 3
