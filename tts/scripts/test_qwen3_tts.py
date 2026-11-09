"""Qwen3-TTS Base 本地音色克隆测试。"""
import time
from pathlib import Path
from _common import ROOT, REF_TEXT, parser, texts, file, destination, report, run, positive_int

def main():
    p = parser(__doc__)
    p.add_argument('--model-dir', type=Path, default=ROOT / 'models/Qwen3-TTS-0.6B-Base')
    p.add_argument('--ref-audio', type=Path, default=ROOT / 'data/references/reference.wav')
    p.add_argument('--ref-text', default=REF_TEXT)
    p.add_argument('--language', default='Chinese')
    p.add_argument('--device', default='cuda:0')
    p.add_argument('--dtype', choices=['bfloat16', 'float16', 'float32'], default='bfloat16')
    p.add_argument('--attn-implementation', default='sdpa')
    p.add_argument('--max-new-tokens', type=positive_int, default=256)
    a = p.parse_args()
    sentences = texts(a)
    model_path = a.model_dir.expanduser().resolve()
    if not model_path.is_dir():
        raise FileNotFoundError(f'模型目录不存在：{model_path}')
    ref = file(a.ref_audio)
    import torch
    import soundfile as sf
    from qwen_tts import Qwen3TTSModel
    device = torch.device(a.device)
    if device.type == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('CUDA 不可用；请检查 GPU，或显式使用 --device cpu --dtype float32')
    print('正在加载模型...', flush=True)
    model = Qwen3TTSModel.from_pretrained(str(model_path), device_map=a.device,
        dtype=getattr(torch, a.dtype), attn_implementation=a.attn_implementation, local_files_only=True)
    print('正在提取参考音色...', flush=True)
    prompt = model.create_voice_clone_prompt(ref_audio=str(ref), ref_text=a.ref_text, x_vector_only_mode=False)
    dest = destination(a, 'qwen3_tts')
    for i, text in enumerate(sentences):
        print(f'正在生成第 {i+1} 句：{text}', flush=True)
        if device.type == 'cuda':
            torch.cuda.synchronize(device)
        start = time.perf_counter()
        wavs, sr = model.generate_voice_clone(text=text, language=a.language,
            voice_clone_prompt=prompt, max_new_tokens=a.max_new_tokens)
        if device.type == 'cuda':
            torch.cuda.synchronize(device)
        elapsed = time.perf_counter() - start
        path = dest / f'output_{i:03d}.wav'
        sf.write(path, wavs[0], sr)
        report(path, elapsed, len(wavs[0]) / sr)

if __name__ == '__main__':
    run(main)
