"""Explicit, sequential local-model benchmark; warmup is reported separately."""
import argparse
from dataclasses import replace
from datetime import datetime, timezone
import gc
import io
import json
from pathlib import Path
import sys
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tts'))
from tts_service.qwen import QwenConfig, Qwen3Engine


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--size', choices=('0.6b', '1.7b'), default='0.6b')
    parser.add_argument('--backends', nargs='+', choices=('standard', 'faster'), default=['standard', 'faster'])
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'tts/outputs/benchmark')
    args = parser.parse_args()
    import torch
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {'checked_at': datetime.now(timezone.utc).isoformat(), 'model_size': args.size,
              'text': '欢迎收听今天的科技播客，我们一起聊聊人工智能如何改变日常生活。',
              'device': torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu', 'runs': []}
    for backend in args.backends:
        config = replace(QwenConfig.from_env(), model_path=ROOT / f'tts/models/Qwen3-TTS-12Hz-{args.size.upper()}-CustomVoice', backend=backend)
        engine = Qwen3Engine(config)
        run = {'backend': backend, 'samples': []}
        started = time.monotonic()
        engine._model = engine._load_model()
        torch.cuda.synchronize()
        run['load_seconds'] = round(time.monotonic() - started, 3)
        started = time.monotonic()
        engine.synthesize('你好，欢迎收听。', 'vivian')
        torch.cuda.synchronize()
        run['warmup_seconds'] = round(time.monotonic() - started, 3)
        for voice in ('vivian', 'uncle_fu'):
            torch.manual_seed(42)
            torch.cuda.synchronize()
            started = time.monotonic()
            audio = engine.synthesize(report['text'], voice)
            torch.cuda.synchronize()
            elapsed = time.monotonic() - started
            with wave.open(io.BytesIO(audio.wav_bytes), 'rb') as wav:
                duration = wav.getnframes() / wav.getframerate()
            path = args.output_dir / f'{args.size}-{backend}-{voice}.wav'
            path.write_bytes(audio.wav_bytes)
            sample = {'voice': voice, 'elapsed_seconds': round(elapsed, 3), 'audio_seconds': round(duration, 3),
                      'rtf': round(elapsed / duration, 4), 'audio_file': str(path)}
            print(json.dumps({'backend': backend, **sample}, ensure_ascii=False), flush=True)
            run['samples'].append(sample)
        run['rtf'] = round(sum(s['elapsed_seconds'] for s in run['samples']) / sum(s['audio_seconds'] for s in run['samples']), 4)
        report['runs'].append(run)
        (args.output_dir / f'{args.size}-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        del engine
        gc.collect()
        torch.cuda.empty_cache()
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
