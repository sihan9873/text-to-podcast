"""The TTS boundary: orchestration does not depend on a particular vendor."""
import io
import json
import math
import os
import re
import struct
import urllib.error
import urllib.request
import wave
from xml.sax.saxutils import escape

class ProviderError(Exception):
    pass

class MockProvider:
    name = '离线流程演示（测试音，非文字朗读）'
    real_speech = False

    def synthesize(self, text, gender, style, speed):
        # A diagnostic tone, deliberately unrelated to input text or style.
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as f:
            f.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            samples = [int(2200 * math.sin(2 * math.pi * 440 * i / 16000))
                       if i < 8000 else 0 for i in range(16000)]
            f.writeframes(struct.pack('<' + 'h' * len(samples), *samples))
        return buf.getvalue(), 'wav', 'audio/wav'

class AzureProvider:
    name = 'Azure Speech（真实语音，需联网及有效额度）'
    real_speech = True

    def __init__(self):
        self.region = os.environ.get('AZURE_SPEECH_REGION', '')
        self.key = os.environ.get('AZURE_SPEECH_KEY', '')
        if not self.key or not re.fullmatch(r'[a-z0-9-]+', self.region):
            raise ProviderError('请在服务端设置有效的 AZURE_SPEECH_REGION 与 AZURE_SPEECH_KEY。')

    def request(self, path, data=None, extra=None):
        req = urllib.request.Request(
            f'https://{self.region}.tts.speech.microsoft.com/{path}', data=data,
            headers={'Ocp-Apim-Subscription-Key': self.key, **(extra or {})})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                result = r.read(15_000_001)
            if len(result) > 15_000_000:
                raise ProviderError('音频超过 demo 大小限制。')
            return result
        except urllib.error.HTTPError as e:
            raise ProviderError(f'语音服务返回 HTTP {e.code}，请检查账号、区域、额度或配置。') from None
        except (urllib.error.URLError, TimeoutError):
            raise ProviderError('语音服务连接失败或超时，请检查网络后重试。') from None

    def synthesize(self, text, gender, style, speed):
        voices = json.loads(self.request('cognitiveservices/voices/list'))
        vendor_style = {'lively': 'cheerful', 'calm': 'calm'}[style]
        candidates = [v for v in voices if v.get('Locale') == 'zh-CN'
                      and v.get('Gender') == {'female': 'Female', 'male': 'Male'}[gender]
                      and vendor_style in v.get('StyleList', [])]
        if not candidates:
            raise ProviderError('此区域未找到支持该性别与风格的中文音色。请改选组合；不能视为该功能已验收。')
        voice = escape(candidates[0]['ShortName'], {'"': '&quot;'})
        rate = {'slow': '-15%', 'normal': '0%', 'fast': '+15%'}[speed]
        ssml = (f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
                f'xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN">'
                f'<voice name="{voice}"><mstts:express-as style="{vendor_style}">'
                f'<prosody rate="{rate}">{escape(text)}</prosody>'
                '</mstts:express-as></voice></speak>')
        data = self.request('cognitiveservices/v1', ssml.encode('utf-8'), {
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
            'User-Agent': 'TPG-course-demo'})
        if len(data) < 100:
            raise ProviderError('未取得有效音频。')
        return data, 'mp3', 'audio/mpeg'

def get_provider():
    mode = os.environ.get('TTS_PROVIDER', 'mock')
    if mode == 'mock':
        return MockProvider()
    if mode == 'azure':
        return AzureProvider()
    raise ProviderError('TTS_PROVIDER 仅支持 mock 或 azure。')
