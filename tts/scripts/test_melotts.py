"""MeloTTS 本地预设音色测试（非音色克隆）。"""
import json
import time
import sys
import os
from pathlib import Path
from _common import ROOT, parser, texts, file, destination, report, run, positive

def main():
    p = parser(__doc__)
    p.add_argument('--config-path', type=Path, default=ROOT / 'models/MeloTTS/config.json')
    p.add_argument('--ckpt-path', type=Path, default=ROOT / 'models/MeloTTS/checkpoint.pth')
    p.add_argument('--language', default='ZH')
    p.add_argument('--device', default='auto')
    p.add_argument('--source-dir', type=Path, default=ROOT / 'third_party/MeloTTS', help='官方源码目录；不存在时使用环境内安装的 melo')
    p.add_argument('--speaker', help='配置中的音色名称；默认首个音色')
    p.add_argument('--list-speakers', action='store_true', help='仅读取配置，不加载模型')
    p.add_argument('--speed', type=positive, default=1.0)
    a = p.parse_args()
    config = file(a.config_path)
    speakers = json.loads(config.read_text(encoding='utf-8'))['data']['spk2id']
    if not speakers:
        raise ValueError('data.spk2id 为空')
    if a.list_speakers:
        for name, identifier in speakers.items():
            print(f'{name}: {identifier}')
        return
    sentences = texts(a)
    checkpoint = file(a.ckpt_path)
    speaker = a.speaker or next(iter(speakers))
    if speaker not in speakers:
        raise ValueError(f'未知音色 {speaker}；可选：{list(speakers)}')
    source = a.source_dir.expanduser().resolve()
    os.environ.setdefault('HF_HOME', str(ROOT / 'models/hf-cache'))
    os.environ.setdefault('NLTK_DATA', str(ROOT / 'data/cache/nltk'))
    if (source / 'melo/api.py').is_file():
        sys.path.insert(0, str(source))
    from melo.api import TTS
    import torch
    import soundfile as sf
    print(f'正在加载 MeloTTS，音色：{speaker}', flush=True)
    model = TTS(language=a.language, device=a.device, config_path=str(config), ckpt_path=str(checkpoint))
    dest = destination(a, 'melotts')
    for i, text in enumerate(sentences):
        if str(model.device).startswith('cuda'):
            torch.cuda.synchronize(model.device)
        start = time.perf_counter()
        audio = model.tts_to_file(text, speakers[speaker], output_path=None, speed=a.speed)
        if str(model.device).startswith('cuda'):
            torch.cuda.synchronize(model.device)
        elapsed = time.perf_counter() - start
        sr = model.hps.data.sampling_rate
        path = dest / f'output_{i:03d}.wav'
        sf.write(path, audio, sr)
        report(path, elapsed, len(audio) / sr)

if __name__ == '__main__':
    run(main)
