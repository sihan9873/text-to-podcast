# 单仓库完整启动与验证

本仓库已经整合 backend 和 tts，不需要应用补丁，也不需要另克隆 Cabite 后端。
以下使用 Linux/WSL Bash 和 Conda。三个服务进程需要三个独立终端。

## 1. 目录与工具

将 PROJECT_ROOT 改为实际仓库根目录；每个新终端重新设置这些变量：

```bash
export PROJECT_ROOT=/你的路径/text-to-podcast
export BACKEND_ROOT="$PROJECT_ROOT/backend"
export TTS_ROOT="$PROJECT_ROOT/tts"
conda --version
ffmpeg -version
ffmpeg -hide_banner -h encoder=libmp3lame
```

不要把模型环境和业务环境混装。以下 create 仅在环境尚不存在时执行：

```bash
conda create -n podcast-tts-service python=3.12 pip
conda create -n podcast-backend python=3.12 pip
cd "$TTS_ROOT"
conda run --no-capture-output -n podcast-tts-service python -m pip install -r requirements/tts-service.txt
cd "$BACKEND_ROOT"
conda run --no-capture-output -n podcast-backend python -m pip install -r requirements-dev.txt
```

backend/requirements-tested-linux.txt 另外记录本次通过测试的 Linux Python 3.12
环境包版本；系统 FFmpeg 和驱动不在该文件内，不是跨平台或 GPU 安装锁。

Conda 只切换解释器，不改变工作目录。运行 app.bootstrap 必须在 backend/；
运行 tts_service 必须在 tts/。这两类环境都不需要安装 PyTorch。

## 2. 配置业务后端

```bash
cd "$BACKEND_ROOT"
cp -n .env.example .env
```

保留数据库/存储配置，确认 .env 的核心设置如下；示例文件默认已经如此：

```dotenv
AUDIO_PROVIDER=local_http
LOCAL_TTS_BASE_URL=http://127.0.0.1:8001
LOCAL_TTS_ENGINE_ID=mock
```

这里先用 Mock TTS 验证所有业务路径，产物是测试音调。不要通过旧 MockAudioGenerator
的固定 MP3 来冒充实际分句合成。shell 已 export 的同名变量优先于 .env。

```bash
cd "$BACKEND_ROOT"
ls app/bootstrap.py
conda run --no-capture-output -n podcast-backend python -m app.bootstrap
```

bootstrap 运行迁移并增量加入两个当前模型的本地角色，不覆盖旧角色和用户资产。

## 3. 跑三组测试（都不使用真实模型）

```bash
cd "$BACKEND_ROOT"
conda run --no-capture-output -n podcast-backend python -m pytest -q
cd "$TTS_ROOT"
conda run --no-capture-output -n podcast-tts-service python -m unittest discover -s tests -v
cd "$PROJECT_ROOT"
conda run --no-capture-output -n podcast-tts-service python -m unittest discover -s tests -v
```

真实 Qwen 测试默认跳过。三组分别验证业务数据库/Worker、TTS、跨模块桥接与工具。
根测试不会自动覆盖两个子项目；不要只在根运行一次 pytest 就认为全部通过。
普通本机不用任何 /tmp 沙箱辅助。本次实际测试范围见 [记录](validation.json)。

## 4. 启动三个进程

终端 T，在 tts/ 启动 Mock TTS：

```bash
cd "$TTS_ROOT"
conda run --no-capture-output -n podcast-tts-service python -m uvicorn tts_service.app:app --host 127.0.0.1 --port 8001
```

终端 B，在 backend/ 启动业务 API：

```bash
cd "$BACKEND_ROOT"
conda run --no-capture-output -n podcast-backend python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

终端 W，在 backend/ 启动独立 Worker，保持运行：

```bash
cd "$BACKEND_ROOT"
conda run --no-capture-output -n podcast-backend python -m app.worker
```

只有 B 没有 W 时，任务会一直 queued。B 持续输出 GET tasks 200 只是轮询成功，
不代表任务已开始，更不能据此判断 Qwen 很慢。queued/started_at=null 时先检查 W。

## 5. 检查 TTS 与业务完整闭环

终端 V，首先验证 TTS 独立短句：

```bash
curl --noproxy '*' --fail-with-body http://127.0.0.1:8001/health
curl --noproxy '*' --fail-with-body http://127.0.0.1:8001/v1/engines
cd "$TTS_ROOT"
conda run --no-capture-output -n podcast-tts-service python scripts/demo_tts_service.py --api-url http://127.0.0.1:8001 --engine-id mock
```

两份 0.25 秒、单声道 PCM16 测试 WAV 在 tts/outputs/tts-demo/ 下。
然后从仓库根目录执行业务自动验证：

```bash
cd "$PROJECT_ROOT"
conda run --no-capture-output -n podcast-tts-service python scripts/verify_backend_flow.py --backend-url http://127.0.0.1:8000 --engine-id mock --task-timeout 900
```

脚本创建独立联调项目，读取实际角色 ID，提交原文、脚本任务，轮询并确认真实版本，
再提交音频任务、下载并解码 MP3。outputs/backend-verification/ 下记录 report.json，
成功时另有 full.mp3。失败退出码非零，报告保留已取得的项目/任务 ID。
脚本不删除旧数据，不自动取消超时的上游推理，也不自动无限重试 POST。

业务任务成功状态是 succeeded。元数据中 Mock 应为 simulated=true、real_speech=false。
听到音调是正常的，LLM 仍是固定 Mock 脚本。Swagger 位于业务 /docs，实际契约以
运行时 /openapi.json 为准，早期 backend/docs 设计材料可能包含未实现的功能。

## 6. 切换真实 Qwen

先按 [模型准备](model-setup.md) 检查独立模型环境、驱动和权重。在终端 T 停止
Mock 进程，再从 tts/ 启动 Qwen configured factory，仍监听 8001。
先运行模型文档中的双音色 smoke test，人工听音确认完整性和采样率。

然后停止 B/W，业务 .env 将 LOCAL_TTS_ENGINE_ID 改为 qwen3-customvoice，保持
local_http 和地址不变。重新初始化以添加这个模型的角色：

```bash
cd "$BACKEND_ROOT"
conda run --no-capture-output -n podcast-backend python -m app.bootstrap
```

按第 4 节**重新启动 B 和 W**，不是只运行 bootstrap。不要沿用旧 Mock 脚本。
随后从根目录生成新的项目/脚本/音频：

```bash
cd "$PROJECT_ROOT"
conda run --no-capture-output -n podcast-tts-service python scripts/verify_backend_flow.py --backend-url http://127.0.0.1:8000 --engine-id qwen3-customvoice --task-timeout 1800
```

如果 W 已停止，原任务会留在 queued；先恢复 W，让现有任务继续，不要立即多次重跑。
客户端超时不代表模型或业务任务已取消，先通过原 task_id 查看结果再决定重提。
真实 Qwen 资产应为 engine_id=qwen3-customvoice、simulated=false、real_speech=true；
script_simulated 仍可为 true。完整 MP3 必须人工听音，确认台词顺序、双角色和间隔。

## 7. 复核音频资产和保存证据

从自动报告取得 audio_result.asset_id，在业务目录做只读查询（替换 123）：

```bash
cd "$BACKEND_ROOT"
conda run --no-capture-output -n podcast-backend python - <<'PY'
import json
from app.core.config import Settings
from app.db.database import Database
from app.db.models import Asset
database = Database(Settings.from_env().database_url)
try:
    with database.sessions() as session:
        asset = session.get(Asset, 123)
        if asset is None:
            raise SystemExit('请填写实际 asset_id')
        print(json.dumps(asset.metadata_json, ensure_ascii=False, indent=2))
finally:
    database.engine.dispose()
PY
```

保存包版本、模型 commit/校验值、硬件/驱动/显存、实际采样率、WAV/MP3 听音结果，
区分冷启动和预热后的 RTF（耗时 / 音频时长）。演示脚本单次 HTTP 测量不是稳态基准。
最终结束 T/B/W 使用各自终端 Ctrl+C，不靠删除数据库或权重清理。
