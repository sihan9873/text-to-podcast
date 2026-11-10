# 本地 TTS 接入与组员联调

基于 `Cabite/text-to-podcast-backend` 提交
`6708347dfcd6d930cc2ff37bf77b21e858af2274`（2026-11-07）。

## 接入结果

已有数据库任务、幂等键、租约、Worker、MP3 保存和播放/下载路由继续复用。
新增 `app/integrations/local_tts.py`，实现原来的 `AudioGenerator.generate(snapshot)`：

```text
POST /api/v1/projects/{id}/audio/generate
  → 数据库 queued 任务（保存音频服务配置和已确认脚本快照）
  → Worker 领取任务并续租
  → LocalTTSAudioGenerator
      → GET TTS /v1/engines、/v1/voices
      → 校验所有台词与角色 → 按 sequence 排序 → 按引擎上限分块
      → 串行 POST TTS /v1/synthesize → 校验 WAV → 重采样
      → 按原顺序拼接，角色切换插入静音 → FFmpeg 编码 MP3 → 解码校验
  → publish_audio 保存资源、音频版本，任务 succeeded
```

不在业务后端导入 Qwen/PyTorch。业务后端和模型服务分别运行，避免破坏现有
模型环境。LLM 仍是原 MockScriptGenerator；真实 TTS 不代表脚本已来自真实 LLM。
生成方法不写业务数据库，不自行发布文件，不在出错时返回固定测试音。

## 配置与依赖

业务 Python 依赖没有新增；HTTP 使用标准库。**local_http 模式额外需要 FFmpeg**
（含 libmp3lame）；MockAudioGenerator 原模式仍不依赖 FFmpeg。
FFmpeg 不会由代码自动安装，模型权重也不会由后端下载。

业务 API 用 8000，TTS 服务用 8001，避免两个 FastAPI 进程端口冲突。
在业务仓库自己的 `.env` 设置（保留其他数据库/存储配置）：

```dotenv
AUDIO_PROVIDER=local_http
LOCAL_TTS_BASE_URL=http://127.0.0.1:8001
LOCAL_TTS_ENGINE_ID=mock
LOCAL_TTS_TIMEOUT_SECONDS=300
LOCAL_TTS_CHUNK_CHARS=120
LOCAL_TTS_SAMPLE_RATE=24000
LOCAL_TTS_TURN_SILENCE_MS=250
FFMPEG_BINARY=ffmpeg
AUDIO_ENCODE_TIMEOUT_SECONDS=60
```

先用 `LOCAL_TTS_ENGINE_ID=mock` 联调链路，产物是测试音调，`real_speech=false`。
真实推理准备好后改为 `qwen3-customvoice`。不支持不存在的引擎时降级到 Mock。

| 配置 | 默认与含义 |
| --- | --- |
| AUDIO_PROVIDER | `mock`；显式设 `local_http` 才调用独立 TTS 服务 |
| LOCAL_TTS_BASE_URL | `http://127.0.0.1:8001`；不允许 URL 内嵌密钥/查询参数/fragment |
| LOCAL_TTS_ENGINE_ID | `qwen3-customvoice` |
| LOCAL_TTS_TIMEOUT_SECONDS | 每次 HTTP 请求 300 秒；允许 0–600 内有限正数 |
| LOCAL_TTS_CHUNK_CHARS | 120；与服务返回的 max_text_length 取较小值，最多 1000 |
| LOCAL_TTS_SAMPLE_RATE | 24000；拼接前统一到单声道 PCM16，范围 8000–48000 |
| LOCAL_TTS_TURN_SILENCE_MS | 250；仅角色切换时插入，范围 0–5000 |
| FFMPEG_BINARY | `ffmpeg`；Windows 可用 `C:/tools/ffmpeg/bin/ffmpeg.exe` |
| AUDIO_ENCODE_TIMEOUT_SECONDS | 每次重采样/编码/解码超时 60 秒，最多 600 |

API、Worker、bootstrap 必须读取同一份配置，修改后重启进程。新任务在提交时
冻结上述配置，Worker 使用快照，不用新的 `.env` 改写旧任务。外部服务本身的
权重版本和别名映射仍由部署者维护，当前未对模型文件实现版本锁定。
只建议一个 Worker 串行调用单卡模型；不要通过增开 Worker 争抢同一 GPU。

## 最小联调步骤

以下统一使用 Conda：轻量 TTS 为 `podcast-tts-service`，业务 API/Worker 为
`podcast-backend`，真实模型继续使用原 `podcast-tts`。已有环境跳过 create；
`conda run` 显式选环境，不需要套用另一种环境工具。

1. 在 TTS 项目根目录启动 Mock 服务（不加载模型、不需要 GPU）：

   ```bash
   conda run --no-capture-output -n podcast-tts-service python -m uvicorn tts_service.app:app --host 127.0.0.1 --port 8001
   ```

2. 在业务后端根目录准备 Conda 环境并安装原依赖：

   ```bash
   conda create -n podcast-backend python=3.12 pip
   conda run --no-capture-output -n podcast-backend python -m pip install -r requirements-dev.txt
   ```

   检查 `ffmpeg -version`。设置上面的 `.env` 后执行
   `conda run --no-capture-output -n podcast-backend python -m app.bootstrap`。
   新增两名本地 TTS 主持人角色，原测试角色和既有用户配置不会被覆盖。
   重复 bootstrap 不会反复添加同一引擎/音色的角色。

3. 在业务仓库启动 API 和另一个终端的 Worker：

   ```bash
   conda run --no-capture-output -n podcast-backend python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   conda run --no-capture-output -n podcast-backend python -m app.worker
   ```

4. `GET /api/v1/roles` 获取角色 ID。选择 `tts_provider=local_http`、
   `tts_model=mock`、`voice_id=host_a/host_b` 的两项；ID 以实际响应为准。
   创建项目、提交原文，再提交脚本任务，示例角色请求：

   ```json
   {"roles":[{"profile_id":2,"role_key":"host_a"},{"profile_id":3,"role_key":"host_b"}]}
   ```

   上面的 2、3 只是示例。脚本成功后读取实际 script_id/version/edit_revision，
   确认脚本，再走原音频生成接口，仍必须携带新的 `Idempotency-Key`。

5. 轮询 `/api/v1/tasks/{task_id}` 到 succeeded；从结果中的 play_url/download_url
   获取 MP3。元数据会记录 `provider=local_http`、`engine_id=mock`、
   `simulated=true`、`real_speech=false`、句数/块数、采样率及声道。

6. 真正接入 Qwen 时，在 TTS 项目启用已有 configured factory，监听 8001：

   ```bash
   TTS_ENABLE_QWEN=1 TTS_QWEN_DEVICE=cuda:0 TTS_QWEN_DTYPE=bfloat16 \
   conda run --no-capture-output -n podcast-tts python -m uvicorn \
     tts_service.configured:configured_app --factory --host 127.0.0.1 --port 8001 --workers 1
   ```

   业务 `.env` 改 `LOCAL_TTS_ENGINE_ID=qwen3-customvoice`，重新 bootstrap 并重启
   API/Worker。重新选择该模型的本地角色生成并确认脚本；**不能沿用测试音色
   或其他模型的旧脚本**。已有 Mock/Qwen 权重和硬件状态按 TTS 项目验收记录为准。
   本次没有下载新权重，也没有宣称已经完成真实 Qwen 推理。

## 角色、脚本和错误契约

角色 `voice_config` 使用已有字段，不改数据库结构：

```json
{"tts_provider":"local_http","tts_model":"qwen3-customvoice","voice_id":"host_a",
 "style":null,"speed":1.0,"extra_params":{}}
```

具体音色由 TTS 服务解析别名。句子 speed 为 null 时继承角色 speed，再为空时
使用 1.0。当前 Qwen 不支持变速，非 1.0 明确失败。style、extra_params 非空
也明确失败，不静默丢弃。角色、文本及参数均在第一次合成 POST 前校验。
句长最多 1000、脚本总字数最多 5000，分块保留原文本和标点。

模型、地址、音色配置错误，超时，损坏 WAV，编码失败等均抛 BusinessError，
Worker 将任务/音频版本标记 failed，并释放项目；没有完整结果就不发布音频。
常见错误码：

| code | 意义 |
| --- | --- |
| TTS_ENGINE_UNAVAILABLE | 引擎未注册、依赖或权重不完整 |
| TTS_INVALID_VOICE_CONFIG / TTS_UNKNOWN_VOICE | 旧 Mock 角色或不匹配模型/音色 |
| TTS_UNSUPPORTED_FEATURE | 非默认语速、风格或额外参数不受支持 |
| TTS_UNAVAILABLE / TTS_TIMEOUT | 服务连接失败或请求超时 |
| TTS_ENGINE_BUSY / TTS_OUT_OF_MEMORY / TTS_MODEL_LOAD_FAILED | 上游稳定错误码映射 |
| TTS_INVALID_AUDIO / TTS_INVALID_RESPONSE | WAV 损坏或上游不符合契约 |
| TTS_ENCODER_UNAVAILABLE / TTS_ENCODING_FAILED / TTS_ENCODING_TIMEOUT | FFmpeg 缺失/失败/超时 |

请求超时不会取消上游已开始的 GPU 推理，不自动重试 POST。失败后用户通过新的
幂等键重提整个音频阶段，旧幂等键仍复用原失败任务。没有分块断点续生成或取消
功能。进度继续使用原 Worker 的领取/完成进度（约 5%→100%），不是逐块百分比。
MP3 时长取最终文件解码后的帧数，可能包含编码器 padding。

## 测试及本次验证范围

在完整业务仓库的正常环境中运行：

```bash
conda run --no-capture-output -n podcast-backend python -m pytest -q
conda run --no-capture-output -n podcast-backend python -m unittest discover -s tests -p test_local_tts.py -v
conda run --no-capture-output -n podcast-backend python -m unittest discover -s tests -p test_local_tts_settings.py -v
```

新增 8 个适配器测试和 3 个设置测试，本次全部通过；包括真实 FFmpeg 的重采样、
拼接、MP3 编码/解码，以及顺序、原文保留、错误与无假成功。另在 TTS 项目中
执行了当前 Mock ASGI 服务→本适配器→MP3 的测试，已通过；不依赖外网或监听 TCP。

新增两个数据库 Worker 回归用例，验证成功发布/配置快照和失败不发布资源。
早期接入阶段未能执行数据库完整测试；本次单仓库整理已使用独立临时数据库
完成后端全套测试，具体结果见 [当前验证记录](../../docs/validation.json)。
真实 TCP 和 Qwen 推理仍需单独验收，不能用数据库测试冒充。原 Windows 锁文件
保持历史记录，新增 requirements-tested-linux.txt 记录本次测试环境。未改模型环境/CUDA/PyTorch。
