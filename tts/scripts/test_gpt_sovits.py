"""调用 GPT-SoVITS 官方 api_v2.py 的非流式 /tts 接口。"""
import io
import json
import time
import wave
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler
from urllib.parse import urlsplit
from urllib.error import HTTPError
from _common import ROOT, REF_TEXT, parser, texts, file, destination, report, run, positive

def main():
    p = parser(__doc__)
    p.add_argument('--api-url', default='http://127.0.0.1:9880')
    p.add_argument('--ref-audio', type=Path, default=ROOT / 'data/references/reference_gpt.wav')
    p.add_argument('--ref-text', default=REF_TEXT)
    p.add_argument('--text-lang', default='zh')
    p.add_argument('--prompt-lang', default='zh')
    p.add_argument('--speed', type=positive, default=1.0)
    p.add_argument('--text-split-method', default='cut5')
    p.add_argument('--timeout', type=positive, default=300)
    p.add_argument('--use-cuda-graph', action='store_true', help='启用上游可选 CUDA Graph 加速；默认关闭以先验证普通推理')
    p.add_argument('--use-flash-attention', action='store_true', help='启用上游可选 FlashAttention；默认关闭')
    a = p.parse_args()
    sentences = texts(a)
    endpoint = urlsplit(a.api_url)
    if endpoint.scheme not in ('http', 'https') or not endpoint.hostname:
        raise ValueError('--api-url 必须是有效的 HTTP/HTTPS 服务根地址')
    # 本机推理请求不经过环境中的 HTTP 代理。
    opener = build_opener(ProxyHandler({})) if endpoint.hostname in ('127.0.0.1', 'localhost', '::1') else build_opener()
    ref = file(a.ref_audio)
    dest = destination(a, 'gpt_sovits')
    print('RTF 为包含 HTTP 开销的端到端指标。', flush=True)
    for i, text in enumerate(sentences):
        payload = dict(text=text, text_lang=a.text_lang, ref_audio_path=str(ref),
            prompt_text=a.ref_text, prompt_lang=a.prompt_lang, speed_factor=a.speed,
            text_split_method=a.text_split_method, media_type='wav', streaming_mode=False,
            use_cuda_graph=a.use_cuda_graph, use_flash_attention=a.use_flash_attention)
        request = Request(a.api_url.rstrip('/') + '/tts', data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'})
        start = time.perf_counter()
        try:
            with opener.open(request, timeout=a.timeout) as response:
                data = response.read()
        except HTTPError as exc:
            raise RuntimeError(f'服务返回 HTTP {exc.code}：{exc.read(4096).decode("utf-8", errors="replace")}') from exc
        elapsed = time.perf_counter() - start
        try:
            with wave.open(io.BytesIO(data), 'rb') as audio:
                duration = audio.getnframes() / audio.getframerate()
                frames = audio.readframes(audio.getnframes())
                if duration <= 0 or len(frames) != audio.getnframes() * audio.getnchannels() * audio.getsampwidth():
                    raise ValueError('空音频或 WAV 数据不完整')
        except (wave.Error, EOFError, ValueError) as exc:
            raise RuntimeError(f'服务未返回有效的 PCM WAV：{data[:200]!r}') from exc
        path = dest / f'output_{i:03d}.wav'
        path.write_bytes(data)
        report(path, elapsed, duration)

if __name__ == '__main__':
    run(main)
