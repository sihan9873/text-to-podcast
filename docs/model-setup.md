# Qwen 模型准备

主引擎为 Qwen3-TTS 0.6B CustomVoice。Base 是克隆模型，不能替代 CustomVoice。
仓库不含权重、GPU 包或 CUDA 安装器，也不会在启动/health 时下载。

复用原 podcast-tts 环境，先检查硬件，不重装已有 torch：

```bash
conda run -n podcast-tts python -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.device_count())"
nvidia-smi
```

新机器需为目标 GPU/驱动准备兼容 torch/torchaudio，再单独准备 qwen-tts 环境。
已核对 qwen-tts 0.1.1 API；这不是任意硬件的推理保证。CPU 需显式 cpu/float32，
性能需单独验收。不要往业务环境安装模型依赖来尝试解决 GPU 兼容性。

可将 TTS_QWEN_MODEL_PATH 指向原有完整 CustomVoice 目录的绝对路径，不复制权重。
若需新下载，经授权后在 tts/ 显式执行（约 2.5 GB，建议预留至少 5 GB）：

```bash
conda run --no-capture-output -n podcast-tts python -c 'from huggingface_hub import snapshot_download; print(snapshot_download(repo_id="Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", local_dir="models/Qwen3-TTS-12Hz-0.6B-CustomVoice"))'
```

必须包含 speech_tokenizer 等完整文件，记录下载 commit 与校验值。SDK 和模型
许可分别核对，本交付不分发任何权重。启动真实服务前停止 8001 上的 Mock：

```bash
# 在 tts/；已有权重也可将下面路径改成绝对路径。
TTS_ENABLE_QWEN=1 TTS_QWEN_MODEL_PATH=models/Qwen3-TTS-12Hz-0.6B-CustomVoice \
TTS_QWEN_DEVICE=cuda:0 TTS_QWEN_DTYPE=bfloat16 \
conda run --no-capture-output -n podcast-tts python -m uvicorn tts_service.configured:configured_app --factory --host 127.0.0.1 --port 8001 --workers 1
```

单句测试（另一个终端，在 tts/）：

```bash
conda run --no-capture-output -n podcast-tts python scripts/demo_tts_service.py --api-url http://127.0.0.1:8001 --engine-id qwen3-customvoice --timeout 300
```

人工听两份 WAV 的文本完整性和音色区别。可解码不代表没有 token 截断；首句若
包含冷启动，不能和之后单次 RTF 混称稳态统计。本次目录整理不重新执行真实模型。
其他选项包括 TTS_QWEN_CACHE_DIR、TTS_QWEN_HOST_A/B、TTS_QWEN_MAX_NEW_TOKENS
及 TTS_QWEN_MAX_TEXT_CHARS。默认 sdpa，不要求另装 FlashAttention。
