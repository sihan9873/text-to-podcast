# 独立 TTS 服务

工作目录为 tts/，主要代码在 tts_service/。业务调用者只使用 HTTP API。

```bash
# 环境已存在跳过 create。
conda create -n podcast-tts-service python=3.12 pip
conda run --no-capture-output -n podcast-tts-service python -m pip install -r requirements/tts-service.txt
conda run --no-capture-output -n podcast-tts-service python -m uvicorn tts_service.app:app --host 127.0.0.1 --port 8001
```

health 不加载模型；/v1/engines、/v1/voices 提供资源与能力信息；/v1/synthesize
短句成功返回 WAV，失败返回 JSON。Mock 无需模型/GPU，Qwen 使用原独立模型环境。
模型位于本目录 models/，或显式设置外部绝对路径，不复制到业务环境。
原 Base/Melo/GPT CLI 保留在 scripts/ 作为独立实验入口，不是默认业务引擎。

[统一验证](../docs/verification.md) · [HTTP 契约](../docs/tts-api.md) · [模型准备](../docs/model-setup.md)
