# 当前版本完整验收流程

适用代码：`feat/voice-cloning@25ffc46`，已合入 `integration/final@0ca2ed8`。编写日期：2026-11-14。

本文提供当前代码可以执行的环境准备、启动、业务操作、接口核验、异常恢复和结果签收流程。文档中的“预期结果”是验收标准，不是已经实际通过的声明。执行时填写实际结果；环境或模型缺失记为“阻塞”，不能记为“通过”。

## 1. 验收范围与通过条件

### 1.1 当前可验收的功能

| 模块 | 当前实现及验收入口 |
| --- | --- |
| 账号 | 注册、登录、退出、Cookie 会话；用户管理、密码修改和重置通过账号 API 验收 |
| 项目 | 新建、列表、详情及用户隔离 |
| 原文 | 粘贴、UTF-8 TXT/Markdown 上传、校验、提交锁定、原文及有序分段持久化 |
| 分段 | 默认 `auto`：不超过 5,000 字符保持全文；超过后按语义边界分段；兼容显式 paragraph/duration 接口参数 |
| 脚本 | 单次生成或长文多阶段编排；1–8 个角色；目标时长、主持风格偏好；版本查询、草稿编辑、确认和取消确认 |
| 音频 | 根据确认版本生成全文 MP3；任务查询、版本快照、播放、下载和 Range 请求 |
| 克隆 | 私有录音上传、声音保存、短句试听、停用/启用、角色绑定、多个克隆角色生成全文 |
| 可靠性 | 幂等提交、项目任务互斥、Worker 心跳/租约、排队任务保留、过期任务失败及失效结果拒绝发布 |

### 1.2 与原需求的差距不能隐藏

原始需求见 [产品需求规格说明书](文字转播客生成系统_产品需求规格说明书.docx)。当前实现验收与原需求全量验收应分别出结论。

| 需求编号 | 当前验收口径 |
| --- | --- |
| FR01 / FR02 / FR03 | 验收文件上传、提交前粘贴编辑和输入校验；原文提交后锁定，不支持覆盖原文 |
| FR11 / FR12 | 必须用真实 LLM 完成脚本生成、人工审核、修订和确认，才能签收真实业务闭环 |
| FR04 | 可选预设音色或私有克隆声音；TTS 朗读风格参数尚未支持。脚本“主持风格”是 LLM 创作偏好，不是 TTS 风格控制 |
| FR05 | 当前只支持 `speed=1.0`，慢速/快速未实现。原需求将该项列为“必须”，未补齐或正式调整范围前不能判定原需求全部通过 |
| FR06 | 当前业务服务不支持“脚本前三句试听”；声音库的克隆短句试听不能替代该需求 |
| FR07 / FR09 / FR10 | 验收全文生成、实际可听播放和 MP3 下载 |
| FR08 | 可查询失败原因、保留旧结果并使用新幂等键重新提交同阶段；`POST /tasks/{id}/retry`、自动重试及候选替换未实现，当前 `can_retry=false` |

以下能力不在当前版本可签收范围：预设声音和克隆声音同场混用、任意语速、TTS 风格控制、逐句音频/候选重生成、浏览器录音、自动转写、声音训练、声音共享市场、云对象存储和跨机器素材传输。配置管理中个人 LLM 密钥、项目 LLM 配置保存和 TTS 配置管理等预留接口仍可能返回 501，以运行时 `/docs` 为准。

### 1.3 验收分级

| 级别 | 配置/用途 | 可以得出的结论 |
| --- | --- | --- |
| M0：仅前端演示 | MSW 开启 | 页面与交互演示；没有真实后端、持久化或语音能力结论 |
| M1：真实业务服务 + Mock 生成 | MSW 关闭，LLM=mock，AUDIO=mock | 账号、项目、保存、审核、任务及固定测试音下载链路通过 |
| M2：真实业务服务 + HTTP Mock TTS | MSW 关闭，LLM=mock，AUDIO=local_http，TTS=mock | 另验证 TTS HTTP、WAV、FFmpeg 拼接和 MP3 编码；仍不是正文朗读 |
| R1：真实预设音色 | LLM=local_http，TTS=qwen3-customvoice | 原文→真实脚本→预设声音正文朗读闭环 |
| R2：真实声音克隆 | LLM=local_http，TTS=qwen3-base | 原文→真实脚本→私有克隆声音正文朗读闭环 |

推荐顺序：自动测试 → M1 → M2 → R1（保留旧能力回归）→ R2 → 长文与克隆联合验收 → 异常恢复。模型不齐时可以先完成 M1/M2，R1/R2 留为阻塞；不能用测试音或测试替身签收真实模型。

## 2. 环境、版本与隔离数据

### 2.1 环境清单

| 项目 | 要求 |
| --- | --- |
| 代码 | 本文基线为 `25ffc46`；执行时记录实际 HEAD、分支和工作区差异 |
| 前端 | Node.js ≥22.12、pnpm 11；锁文件和 `packageManager` 版本以仓库为准 |
| Python | 建议沿用已有独立环境；新机器按各目录 requirements 准备，不把模型依赖安装进业务环境 |
| 本机环境参考 | 业务 `podcast-backend`；轻量 TTS 测试 `podcast-tts-service`；真实 TTS `podcast-tts`；真实 LLM `podcast-llm` |
| 音频工具 | `ffmpeg`、`ffprobe`，支持 MP3 编解码和 libmp3lame |
| 模型 | LLM：本地 Qwen2.5-0.5B-Instruct；预设 TTS：0.6B CustomVoice；克隆 TTS：Base；路径必须对应正确模型类型 |
| 浏览器 | Chrome、Edge；验收时记录版本 |
| 参考声音 | 两位说话人的授权录音与准确原文；建议每段 5–15 秒、单人、无配乐，实际允许 3–30 秒 |

GPU/内存是否足够以本机实测为准，不假定固定显存占用或实时率。同一 TTS 进程不能同时启用 Base 与 CustomVoice；LLM 与 TTS 若共用 GPU，也要观察两者实际总占用。

依赖文件：账号 `backend/requirements-dev.txt`，生成服务 `generation-backend/requirements.lock`，轻量 TTS `tts/requirements/tts-service-test.txt`，LLM `llm/requirements.txt`。轻量 TTS 依赖不包含真实 Qwen SDK / PyTorch；真实模式需要已准备的模型环境。模型准备另见 [模型设置](model-setup.md)、[LLM 指南](local-llm.md) 和 [克隆部署](voice-cloning.md)，端口统一以本文为准，不沿用旧指南中的冲突端口。

### 2.2 版本与工具预检

以下命令使用当前 Linux/WSL 的 Bash。Windows 用户可在 WSL 中按本文执行；不要混用两种 shell 的环境变量语法。

```bash
export PODCAST_REPO=/home/wyyalhz/projects/text-to-podcast-integration-final
cd "$PODCAST_REPO"
git status --short --branch
git rev-parse HEAD
git log -3 --oneline
node --version
pnpm --version
ffmpeg -version
ffprobe -version
```

有 GPU 时另记录 `nvidia-smi`。不需要为验收重装已有 CUDA/PyTorch。新机器缺依赖时，在对应的新虚拟环境中安装；本文不要求覆盖既有环境。

### 2.3 创建一轮独立验收目录

不要删除或清空原有数据库。每种运行模式使用一轮新目录，账号库、业务库、声音素材、日志和下载件都放入该目录；`generation-backend/data/` 已被 Git 忽略。

```bash
mkdir -p "$PODCAST_REPO/generation-backend/data"
export PODCAST_ACCEPTANCE="$(mktemp -d "$PODCAST_REPO/generation-backend/data/acceptance-XXXXXXXX")"
printf '本轮目录：%s\n' "$PODCAST_ACCEPTANCE"

# 依次选择 mock、http-mock、customvoice 或 clone；每次切换模式新建一轮目录。
export PODCAST_MODE=mock

# customvoice / clone 模式需要先填写实际本地路径；Mock 模式无需填写。
# export PODCAST_LLM_MODEL_PATH=/absolute/path/to/Qwen2.5-0.5B-Instruct
# export PODCAST_CUSTOMVOICE_MODEL_PATH=/absolute/path/to/Qwen3-TTS-12Hz-0.6B-CustomVoice
# export PODCAST_BASE_MODEL_PATH=/absolute/path/to/Qwen3-TTS-12Hz-0.6B-Base
```

下面的准备代码只创建本轮隔离配置和测试材料，不启动服务、不下载模型。配置含本机测试密码及内部令牌，只能保留在本轮目录内。

```python
import json
import os
from pathlib import Path
import secrets
import shlex
import struct
import wave

repo = Path(os.environ["PODCAST_REPO"]).resolve()
run = Path(os.environ["PODCAST_ACCEPTANCE"]).resolve()
assert run.is_relative_to(repo / "generation-backend" / "data")
mode = os.environ["PODCAST_MODE"]
assert mode in {"mock", "http-mock", "customvoice", "clone"}
assert not (run / "common.env").exists(), "本目录已经准备过，请新建一轮目录"
for folder in ("fixtures", "evidence", "logs", "assets", "references"):
    (run / folder).mkdir(exist_ok=True, mode=0o700)

def env_file(name, values):
    path = run / name
    with path.open("x", encoding="utf-8") as output:
        output.write("".join(f"export {k}={shlex.quote(str(v))}\n" for k, v in values.items()))
    path.chmod(0o600)

def json_file(name, value):
    path = run / name
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    path.chmod(0o600)

models = {name: os.environ.get(name, "") for name in (
    "PODCAST_LLM_MODEL_PATH", "PODCAST_CUSTOMVOICE_MODEL_PATH", "PODCAST_BASE_MODEL_PATH")}
if mode in {"customvoice", "clone"}:
    needed = ["PODCAST_LLM_MODEL_PATH", "PODCAST_CUSTOMVOICE_MODEL_PATH" if mode == "customvoice" else "PODCAST_BASE_MODEL_PATH"]
    for name in needed:
        assert models[name] and Path(models[name]).is_dir(), f"缺少实际模型目录：{name}"

engine = {"mock": "mock", "http-mock": "mock", "customvoice": "qwen3-customvoice", "clone": "qwen3-base"}[mode]
token = secrets.token_urlsafe(32)
env_file("common.env", {"PODCAST_REPO": repo, "PODCAST_ACCEPTANCE": run, "PODCAST_MODE": mode})
env_file("account.env", {
    "TEXTCAST_DATABASE_PATH": run / "accounts.sqlite3",
    "TEXTCAST_CORS_ORIGINS": "http://localhost:5173",
    "TEXTCAST_SESSION_TTL_SECONDS": 28800, "TEXTCAST_SECURE_COOKIES": "false",
    "TEXTCAST_ALLOW_REGISTRATION": "true",
    "TEXTCAST_BOOTSTRAP_ADMIN_USERNAME": "", "TEXTCAST_BOOTSTRAP_ADMIN_PASSWORD": "",
})
env_file("generation.env", {
    "DATABASE_URL": "sqlite:///" + (run / "generation.sqlite3").as_posix(),
    "STORAGE_DIR": run / "assets", "VOICE_REFERENCE_DIR": run / "references",
    "TEXTCAST_AUTH_URL": "http://127.0.0.1:8000", "DEVELOPMENT_USER_ID": 1,
    "WORKER_POLL_SECONDS": 0.5, "WORKER_LEASE_SECONDS": 60, "MAX_PENDING_TASKS": 100,
    "CORS_ORIGIN": "http://localhost:5173",
    "LLM_PROVIDER": "local_http" if mode in {"customvoice", "clone"} else "mock",
    "LOCAL_LLM_BASE_URL": "http://127.0.0.1:8003",
    "LOCAL_LLM_MODEL_ID": "Qwen/Qwen2.5-0.5B-Instruct",
    "LOCAL_LLM_TIMEOUT_SECONDS": 300, "LOCAL_LLM_MAX_NEW_TOKENS": 2048,
    "AUDIO_PROVIDER": "mock" if mode == "mock" else "local_http",
    "LOCAL_TTS_BASE_URL": "http://127.0.0.1:8002", "LOCAL_TTS_ENGINE_ID": engine,
    "LOCAL_TTS_TIMEOUT_SECONDS": 300, "LOCAL_TTS_CHUNK_CHARS": 120,
    "LOCAL_TTS_SAMPLE_RATE": 24000, "LOCAL_TTS_TURN_SILENCE_MS": 250,
    "FFMPEG_BINARY": "ffmpeg", "AUDIO_ENCODE_TIMEOUT_SECONDS": 60,
    "TTS_INTERNAL_TOKEN": token,
})
env_file("tts.env", {
    "TTS_ENABLE_QWEN": int(mode == "customvoice"), "TTS_ENABLE_QWEN_BASE": int(mode == "clone"),
    "TTS_QWEN_MODEL_PATH": models["PODCAST_CUSTOMVOICE_MODEL_PATH"] or run / "not-configured-customvoice",
    "TTS_QWEN_BASE_MODEL_PATH": models["PODCAST_BASE_MODEL_PATH"] or run / "not-configured-base",
    "TTS_QWEN_DEVICE": "cuda:0", "TTS_QWEN_DTYPE": "bfloat16",
    "TTS_QWEN_MAX_NEW_TOKENS": 2048, "TTS_QWEN_MAX_TEXT_CHARS": 120,
    "TTS_QWEN_HOST_A": "vivian", "TTS_QWEN_HOST_B": "uncle_fu",
    "VOICE_REFERENCE_DIR": run / "references", "TTS_INTERNAL_TOKEN": token,
})
env_file("llm.env", {"LLM_MODEL_PATH": models["PODCAST_LLM_MODEL_PATH"] or run / "not-configured-llm", "LLM_DEVICE": "cuda:0"})
for who in ("a", "b"):
    password = secrets.token_urlsafe(18)
    json_file(f"register-{who}.json", {"username": f"qa_{who}", "password": password, "displayName": f"验收用户{who.upper()}"})
    json_file(f"login-{who}.json", {"username": f"qa_{who}", "password": password})

fixtures = run / "fixtures"
short = "海岚图书馆将于2025年3月启动夜读试点，为期六周。活动每周三20点至22点开放，每场24个名额。负责人是林青，预算为3600元，不收报名费。请用主持人与嘉宾的对话介绍安排、报名方式和注意事项，不要编造地点或赞助方。"
for name, value in {
    "short.txt": short,
    "empty.txt": "",
    "blank.txt": " \n\t ",
    "boundary-5000.txt": "甲" * 5000,
    "boundary-5001.txt": "乙" * 5001,
    "long-7206.txt": "\n\n".join(c * 1800 for c in "甲乙丙丁"),
    "boundary-100000.txt": "文" * 100000,
    "boundary-100001.txt": "文" * 100001,
    "bom-crlf.txt": "\ufeff第一段。\r\n\r\n第二段。",
}.items():
    (fixtures / name).write_text(value, encoding="utf-8", newline="")
chapters = [
    ("活动缘起", "海岚图书馆的夜读试点于2025年3月开始，为期六周。负责人是林青，每周三20点至22点开放。"),
    ("报名组织", "每场有24个名额，采用馆内登记。报名免费，没有商业赞助，不要求读者购买产品。"),
    ("场地安排", "试点只使用一楼阅览室，不开放二楼书库。读者可以自带纸质书，但不能进行直播或推销。"),
    ("复盘计划", "总预算为3600元。每次活动后收集匿名反馈，六周结束后评估是否继续，不提前承诺常态开放。"),
]
sections = []
for title, facts in chapters:
    paragraphs = [f"记录{i:02d}：{facts}讨论需要同时考虑安静阅读、公共空间使用和服务人员的工作负担。组织者希望读者理解试点与长期服务的区别，说明规则时应保持清晰，避免夸大效果。反馈时既要写下值得保留的做法，也要列出需要调整的地方；不同意见应分别记录，不能把少数人的感受当成所有人的结论。" for i in range(1, 13)]
    sections.append("## " + title + "\n\n" + "\n\n".join(paragraphs))
story = "# 虚构夜读试点验收素材\n\n" + "\n\n".join(sections)
assert 5000 < len(story) < 100000
(fixtures / "long-story.md").write_text(story, encoding="utf-8")
(fixtures / "invalid-utf8.txt").write_bytes("中文".encode("gbk"))
(fixtures / "unsupported.pdf").write_bytes(b"acceptance fixture, not a PDF parser test")
(fixtures / "too-large.txt").write_bytes(b"a" * (2 * 1024 * 1024 + 1))
(fixtures / "broken.wav").write_bytes(b"broken audio")
(fixtures / "over-limit.wav").write_bytes(b"0" * (10 * 1024 * 1024 + 1))
for seconds, name in ((1, "too-short.wav"), (4, "silent.wav"), (31, "too-long.wav")):
    with wave.open(str(fixtures / name), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes(struct.pack("<h", 0 if seconds == 4 else 1000) * (24000 * seconds))
print("准备完成：", run)
print("长文实际字符数：", len(story))
print("配置和登录请求均为本轮私有文件；录音负向样本不能用于真实音色验收。")
```

执行方法：将上面的 Python 内容存为本轮目录下的 `prepare.py`，在设置好环境变量的终端运行 `python "$PODCAST_ACCEPTANCE/prepare.py"`。不要重复运行到同一个目录。

后续每个终端先设置本轮实际路径，再加载配置。例如：

```bash
# 将本行替换成本轮 mktemp 输出的实际目录。
export PODCAST_ACCEPTANCE=/absolute/path/to/this/acceptance-directory
source "$PODCAST_ACCEPTANCE/common.env"
```

## 3. 自动检查与历史验证基线

已有依赖的机器直接执行。全新环境先按各模块 requirements 安装；前端新机器运行 `pnpm install --frozen-lockfile`。不要在验收中静默升级已有模型环境。

| 目录/环境 | 命令 | 本文基线的历史结果 |
| --- | --- | --- |
| frontend | `pnpm check` | 22 项通过；类型检查和构建通过；lint 4 条既有 warning，无 error |
| backend，业务环境 | `python -m pytest -q` | 18 项通过；合并时未修改账号代码 |
| generation-backend，业务环境 | `python -m pytest -q` | 48 项通过，含长文与克隆联合测试 |
| llm，轻量服务环境 | `python -m unittest discover -s tests -v` | 5 项通过 |
| tts，轻量服务环境 | `python -m unittest discover -s tests -v` | 29 项通过，1 项真实 CustomVoice 测试跳过 |

这些是已有记录，不代表本轮已重新执行。实际执行结果填到验收单。此前本工具环境出现 TestClient 线程唤醒挂起，使用了临时事件循环轮询辅助；普通终端优先执行标准命令。若挂起，保留线程栈和依赖版本，不能删除断言、跳过失败用例后宣称全部通过。参见 [验证记录](voice-cloning-validation.json)。

自动测试采用 SDK/HTTP 替身的用例只证明协议和状态机；即使全部通过，仍需完成下面的真实 HTTP 和浏览器操作。

## 4. 服务启动与健康门槛

### 4.1 启动关系

浏览器 `localhost:5173` → Vite 代理 → 账号 8000 / 生成 API 8001；独立 Worker 读取生成数据库，调用 TTS 8002 / LLM 8003。M1 不需要启动模型服务；M2 只需 Mock TTS；R1/R2 两个模型服务均需启动。

以下每段放在独立终端执行，并先加载本轮 `common.env`。可以在 Conda 初始化后的 shell 使用 `conda activate`；如果没有已有环境，替换为对应虚拟环境的激活命令。

**终端 1：账号。** 账号服务只读进程环境，不自动加载本目录 `.env`；本步骤的 `source` 不可省略。

```bash
conda activate podcast-backend
source "$PODCAST_ACCEPTANCE/account.env"
cd "$PODCAST_REPO/backend"
python -m app.cli create-admin --username qa_admin --display-name 验收管理员
# 按交互提示设置本轮管理员密码；管理员只需创建一次。
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**终端 2：生成 API。**

```bash
conda activate podcast-backend
source "$PODCAST_ACCEPTANCE/generation.env"
cd "$PODCAST_REPO/generation-backend"
python -m app.bootstrap
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

**终端 3：Worker。** 必须与 API 使用同一份配置、同一个数据库、存储目录及内部令牌。

```bash
conda activate podcast-backend
source "$PODCAST_ACCEPTANCE/generation.env"
cd "$PODCAST_REPO/generation-backend"
python -m app.worker > "$PODCAST_ACCEPTANCE/logs/worker.log" 2>&1 &
export PODCAST_WORKER_PID=$!
printf '%s\n' "$PODCAST_WORKER_PID" > "$PODCAST_ACCEPTANCE/worker.pid"
wait "$PODCAST_WORKER_PID"
```

**终端 4：TTS。** M2 使用轻量环境；R1/R2 替换为 `conda activate podcast-tts`。

```bash
conda activate podcast-tts-service
source "$PODCAST_ACCEPTANCE/tts.env"
cd "$PODCAST_REPO/tts"
python -m uvicorn tts_service.configured:configured_app --factory --host 127.0.0.1 --port 8002 --workers 1
```

**终端 5：LLM，仅 R1/R2。**

```bash
conda activate podcast-llm
source "$PODCAST_ACCEPTANCE/llm.env"
cd "$PODCAST_REPO/llm"
python -m uvicorn llm_service.app:app --host 127.0.0.1 --port 8003 --workers 1
```

**终端 6：前端，M1/M2/R1/R2 均关闭 MSW。** 使用此命令的开发代理，不能直接把 `pnpm preview` 当成已配置生产反向代理的部署。

```bash
cd "$PODCAST_REPO/frontend"
VITE_ENABLE_MOCK=false pnpm dev --host 127.0.0.1 --port 5173 --strictPort
```

浏览器统一访问 `http://localhost:5173`，不要在本轮混用 `127.0.0.1:5173`。当前代理将 Cookie 域重写为 localhost。更换账号库/运行模式后先退出或清除本网站旧 Cookie，并确认旧 MSW 没有继续拦截请求。

如果只执行 M0 页面演示，在不运行上述后端的情况下使用 `VITE_ENABLE_MOCK=true pnpm dev --host 127.0.0.1 --port 5173 --strictPort`。M0 的数据与真实服务不是同一份，不将它的项目、任务和音频作为下述后端验收证据。

### 4.2 健康检查

```bash
curl --noproxy '*' -fsS http://127.0.0.1:8000/api/health
curl --noproxy '*' -fsS http://127.0.0.1:8001/api/v1/health/ready
# M2/R1/R2：
curl --noproxy '*' -fsS http://127.0.0.1:8002/health
curl --noproxy '*' -fsS http://127.0.0.1:8002/v1/engines
# R1/R2：
curl --noproxy '*' -fsS http://127.0.0.1:8003/health
curl --noproxy '*' -fsS http://127.0.0.1:8003/v1/models
```

| 门槛 | 预期 |
| --- | --- |
| 业务 ready | `status=ready`，`authentication=account_service`，provider/engine 与本轮模式一致 |
| M2 TTS | `mock` 可用，不能据此声称真实人声 |
| R1 TTS | `qwen3-customvoice` 的 `installed=true`，使用有效 0.6B CustomVoice 文件 |
| R2 TTS | `qwen3-base` 的 `installed=true`、`supports_cloning=true`、`model_revision` 非空 |
| 真实 LLM | `/v1/models` 中指定模型 `installed=true` |
| 首次推理前 | 模型 `loaded=false` 可以正常；检查和列表不应加载权重或自动下载 |

`/health=ok` 只证明进程存活，不证明权重、GPU 或音质可用。`installed=true` 也不是成功推理证明。门槛不满足时先排查，不进入真实模型签收。

## 5. 账号、会话与用户隔离

创建两个测试账号 A/B，建议使用普通窗口和独立浏览器配置或隐私窗口，避免共享 Cookie。可以从本轮 `register-a.json` / `register-b.json` 取得账号资料，在页面注册后登录。

| 编号 | 操作 | 预期结果/证据 |
| --- | --- | --- |
| U01 | 未登录直接打开项目页 | 跳到登录；未登录业务 API 返回 401 |
| U02 | 注册 A，重复注册同名用户 | 首次成功；重复显示用户名已存在，账号服务为 409 |
| U03 | 输入错误密码，再用正确密码登录 | 错误不建立会话；正确后进入项目页；网络响应有账号结果、浏览器收到 HttpOnly Cookie |
| U04 | 登录后刷新页面、直接进入项目链接 | 会话恢复，不因响应包装差异误判登录失败 |
| U05 | 退出后刷新或再次访问业务 API | 退出正常；原会话不可继续操作；账号 logout 为 204，前端不能因空响应报错 |
| U06 | A 创建项目、角色、声音和音频，B 查看列表并猜测 A 的 ID | B 的列表不含 A 的资源；详情、任务、声音、播放下载均不可越权，通常返回 404 |
| U07 | 给 Cookie 写请求传 `Origin: https://evil.example` | 返回 403 `CSRF_FAILED`，不修改数据；不能用伪造的 CSRF token 绕过 |

管理员和个人资料功能按 API 验收，不要求当前前端存在完整管理页面。在独立浏览器配置中通过前端登录 `qa_admin`，再打开同一主机名的 `http://localhost:8000/docs` 使用 Try it out；或使用携带管理员 Cookie 的 HTTP 客户端执行。不要把 localhost 的会话直接用于 127.0.0.1 的请求。

| 编号 | API/操作 | 预期 |
| --- | --- | --- |
| U08 | 管理员 `GET/POST /api/admin/users` | 可查询、搜索、按角色/状态过滤并创建测试用户 |
| U09 | 普通用户访问同一管理接口 | 403 `ADMIN_REQUIRED` |
| U10 | 管理员 `PATCH /api/admin/users/{id}` 停用 B，再恢复 | 停用用户不能继续登录/使用会话；恢复后可重新登录 |
| U11 | `POST /api/admin/users/{id}/reset-password` | 重置成功 204，旧会话失效；只能使用新密码重新登录 |
| U12 | `PATCH /api/auth/me`、`POST /api/auth/change-password` | 昵称保存；错误旧密码被拒绝；正确修改后旧凭据失效，新会话可用 |
| U13 | 管理员修改自己的角色/启用状态 | 拒绝自锁操作；不能破坏至少一个有效管理员的约束 |

账号 API 使用 `displayName`、`user.id` 等字段，业务 API 使用 `{code,data,...}` 包装和整数 ID。账号用户 ID 与生成库的内部用户 ID不是同一概念，不要据此手工改数据库。浏览器统一 API 客户端已承担字段适配。

## 6. 原文输入、保存与自动分段

每个输入测试使用新项目。文件选择器中打开本轮 `fixtures/`；保存类用例应同时查看页面、Network 和分段 API。纯重复字边界材料只测试保存/长度/分段，不用于评估真实 LLM 内容质量。

| 编号 | 输入/操作 | 预期 |
| --- | --- | --- |
| I01 | 粘贴 `short.txt`，提交前编辑一处，再“提交并生成脚本” | 保留最终编辑内容；提交成功后进入角色/生成设置；短文不强制先做分段预览 |
| I02 | 上传有效 UTF-8 TXT；另建项目上传 `long-story.md` | 正确识别 TXT/Markdown，保留原文和文件名；不是上传了文件就立即启动模型 |
| I03 | 空文、空白文、空文件 | 明确拒绝；不创建生成任务 |
| I04 | `unsupported.pdf`、`invalid-utf8.txt`、`too-large.txt` | 分别拒绝不支持类型、非法 UTF-8、超过 2 MiB 的文件 |
| I05 | `bom-crlf.txt` | BOM/换行按实现规范化，中文无乱码；保存后的 SHA 以规范化文本为准 |
| I06 | `boundary-5000.txt`，使用默认 auto | 完整保存为一个片段，`boundary_type=complete` |
| I07 | `boundary-5001.txt`，默认 auto | 进入长文处理并拆成有序 semantic 片段，没有漏字或倒序 |
| I08 | `long-7206.txt`，预览自动分段 | 四个片段依次为 1,800 个甲、乙、丙、丁；预览不调用 LLM，也不写入正式 SourceChunk |
| I09 | 确认提交 I08，再刷新、退出登录重登 | `source_text`、文件信息、分段数、顺序及哈希稳定；片段仍存在 |
| I10 | 已提交项目再次修改/替换原文，或再次 PUT source | 原文锁定，API 返回 409 `SOURCE_LOCKED`；旧原文和旧分段保持不变 |
| I11 | `boundary-100000.txt` / `boundary-100001.txt` | 前者可保存；后者拒绝。超过 50,000 字符会提示建议上限，但不得静默截断合法输入 |
| I12 | 通过 API 显式指定 paragraph 或 duration 预览 | 旧模式仍可用，结果顺序稳定；不要求新版页面提供旧模式选择器 |

保存结果核验接口：

```text
GET /api/v1/projects/{project_id}
GET /api/v1/projects/{project_id}/source/chunks
```

检查 `source_submitted=true`、`source_hash`、`source_character_count`、`source_chunk_count`；分段 `sequence` 从 1 连续递增，且与提交素材顺序相同。source/chunks 的列表字段为 `data.items`，预览/提交响应中的片段字段为 `data.chunks`。Markdown 的预计朗读字符数可不含链接地址、标记等，不要将其与原文字符数混为一谈。

100,000 字符用例只要求保存、校验和分段；真实模型质量用 `long-story.md` 或团队批准的长文。输入容量不代表生成 100,000 字台词：单次 LLM 输入 ≤5,000 字符，最终台词总长仍 ≤5,000 字符。

## 7. 角色、真实脚本与审核版本

### 7.1 先准备当前部署可用的角色

- M1：角色模板选择模拟测试音。
- M2：选择 `local_http / mock` 下的有效音色或 host_a/host_b 别名。
- R1：选择 `local_http / qwen3-customvoice` 的可用预设音色，建立“主持人”和“嘉宾”两个模板。
- R2：先完成第 9 节的声音保存和角色绑定，再开始生成；新用户没有默认 Base 声音是正常现象。
- 语速保持 1.0，不填写 TTS 风格或额外参数。不能将历史 Mock 角色直接当成本轮真实模型角色。

| 编号 | 操作 | 预期 |
| --- | --- | --- |
| R01 | 新建、改名、修改描述、停用/启用角色 | 刷新后持久化；列表可按状态过滤；只看到当前用户的模板 |
| R02 | 删除已被历史脚本引用的角色 | 采用停用语义保留历史；旧脚本/音频不因外键丢失而损坏 |
| R03 | 绑定不存在、他人、已停用声音或不属于本部署的音色 | 拒绝保存，不能靠伪造 ID 绕过 |
| R04 | 传不支持的语速、TTS 风格或额外参数 | 拒绝或页面不提供；不能静默忽略后标为“已支持” |

### 7.2 短文脚本

在新项目提交 `short.txt` 后，选择两个角色，设置目标 2–5 分钟和清晰、自然的主持风格，点击生成。目标时长是创作偏好，不是成品时长保证；当前输出长度和 token 上限会约束实际节目长度。

| 编号 | 操作 | 预期 |
| --- | --- | --- |
| S01 | 原文未提交时直接调用脚本生成 | 拒绝，`SOURCE_NOT_SUBMITTED` |
| S02 | 提交合法角色和风格 | 返回 202 与 task_id；任务经历 queued/running/succeeded，API 在生成期间仍可查询 |
| S03 | 任务运行中重复点生成 | 页面阻止或 API `TASK_ALREADY_RUNNING`，不能创建并行项目任务 |
| S04 | 查看生成脚本和版本列表 | 标题、摘要、角色、连续台词顺序完整；每个选定角色至少发言一次；结果为 draft |
| S05 | 编辑标题、摘要、台词、角色名称或声音，再保存 | edit_revision 增加，刷新仍存在；只修改本脚本，不反向覆盖模板或历史音频 |
| S06 | 空台词、非法角色、旧修订号保存 | 拒绝非法输入；旧修订返回 `REVISION_CONFLICT`，避免覆盖他人编辑 |
| S07 | 草稿未确认时直接提交音频任务 | 拒绝，`SCRIPT_NOT_CONFIRMED` |
| S08 | 人工审核后确认脚本 | 状态 confirmed，confirmed_revision 与 edit_revision 一致；项目绑定该确认脚本 |
| S09 | 确认后尝试直接编辑；随后取消确认再编辑 | 直接编辑拒绝 `SCRIPT_LOCKED`；取消确认后可编辑，重生成音频前需重新确认 |
| S10 | 修改角色模板后查看旧脚本 | 旧脚本保留生成时的声音配置；模板更新不会悄悄改变旧脚本 |

R1/R2 中人工核对短文的六周、每周三 20–22 点、24 个名额、林青、3600 元、免费等事实；不得捏造地点或赞助方。检查是否口语化、角色衔接自然、有无明显重复或未读完整。M1/M2 返回预置台词，不能用于通过此内容质量用例。

### 7.3 长文连贯生成

用 `long-story.md` 另建项目，并在 R1 或 R2 中生成。验收前记录其实际字符数、SourceChunk 列表和请求偏好。

| 编号 | 操作/观察 | 预期 |
| --- | --- | --- |
| L01 | 长文提交后生成脚本，查看任务 | 进入分析、规划、分节、润色流程；轮询可能错过短暂阶段，必要时以任务快照/服务日志或自动测试补充证据 |
| L02 | 查看模型请求或自动化验证 | 每次 source_text 不超过 5,000 字符；基于已保存有序片段处理，不将全文直接塞入单次请求 |
| L03 | 对照最终完整脚本 | 开头、中部、结尾事实均有覆盖；人名、术语、时间及否定信息一致；没有把“无商业赞助”写成“有赞助” |
| L04 | 听读段落衔接 | 不机械重复介绍、开场和结尾；不把“共享记忆”“第几轮处理”等内部提示写进节目台词 |
| L05 | 对照最终角色 | 所选角色均出现，声音配置仍引用正确版本；脚本先保持草稿，由人确认 |
| L06 | R2 中确认后生成全文音频 | 从自动分段到最终克隆 MP3 连续跑通，记录同一项目下的脚本任务、音频任务及声音版本关联 |

对应阶段代码：`analyzing_source`、`planning_script`、`drafting_sections`、`refining_script`。目标 20 分钟不等于系统已保证输出 20 分钟；对时长有硬性要求时，应先约定允许误差并按成品实测判定。

## 8. 全文音频、播放与下载

确认脚本后，在音频页点击“生成全文音频”。当前业务能力返回 `audio_preview=false`、`sentence_audio=false`，不要求出现前三句试听、逐句播放器或候选替换按钮。

| 编号 | 操作 | 预期 |
| --- | --- | --- |
| A01 | 根据确认版本提交全文音频 | 202 与 task_id；完成后产生 audio_version_id、asset_id 和播放/下载地址 |
| A02 | 查看版本详情 | script_snapshot/config_snapshot 与提交时一致；版本、脚本修订、角色声音可追溯 |
| A03 | 浏览器播放、暂停、拖动，再刷新 | 可解码播放，不因 Cookie 路径/代理丢失而 401；有 Range 请求时响应正确 |
| A04 | 下载 MP3，在浏览器外播放器打开 | 文件非空、可完整解码；真实模式应朗读已确认正文，而不是固定测试音 |
| A05 | 再生成一个音频版本 | 新版本与旧版本可分别查看；旧下载件不被覆盖 |
| A06 | 取消确认、编辑脚本并保存，再查看旧音频 | 旧音频保留；旧版本 `source_script_changed=true`，不会自动重新合成 |
| A07 | B 或未登录客户端播放/下载 A 的资源 | 拒绝；不能绕过 owner 检查直接读文件 |

从页面 Network 记录 ID 后，可使用第 11 节的会话进行以下检查：

```bash
# 在本终端填写本轮实际 ID。
export PODCAST_ASSET_ID=1
curl --noproxy '*' -fsS -b "$PODCAST_ACCEPTANCE/qa-a.cookies" \
  "http://localhost:5173/api/v1/audio-assets/$PODCAST_ASSET_ID/download" \
  -o "$PODCAST_ACCEPTANCE/evidence/full.mp3"
ffprobe -v error -show_entries format=duration,size -of json \
  "$PODCAST_ACCEPTANCE/evidence/full.mp3"
ffmpeg -v error -i "$PODCAST_ACCEPTANCE/evidence/full.mp3" -f null -
sha256sum "$PODCAST_ACCEPTANCE/evidence/full.mp3"
curl --noproxy '*' -sS -D "$PODCAST_ACCEPTANCE/evidence/range.headers" \
  -b "$PODCAST_ACCEPTANCE/qa-a.cookies" -H 'Range: bytes=0-15' \
  "http://localhost:5173/api/v1/audio-assets/$PODCAST_ASSET_ID/play" \
  -o "$PODCAST_ACCEPTANCE/evidence/range.bin"
```

核对正常下载 200、Content-Type 为 audio/mpeg、大小与版本详情一致、时长大于零、FFmpeg 无解码错误；Range 为 206，正文 16 字节且 Content-Range 合理。音质验收需人工听完整节目，不能仅以文件存在或 ffprobe 成功签收。

### 8.1 真实/模拟证据判定

- M1：产物 `simulated=true`、`real_speech=false`，且是固定测试音。
- M2：engine_id=mock、simulated=true；即使经过真实 FFmpeg 也不是正文人声。
- R1/R2：音频 metadata 的 engine_id 为目标真实引擎、`real_speech=true`、`simulated=false`；还必须试听并对照正文。
- LLM 是否真实需看脚本任务 `input_snapshot.llm_config.provider`、脚本 `llm_snapshot.simulated` 及模型调用日志。当前音频 `metadata.script_simulated` 可能使用默认 true，不能仅凭该字段否决或证明真实 LLM；将此元数据局限记录在验收结果中，不能修改记录假装已修复。
- R2 还要记录 `voice_versions`、参考音频 SHA256 和模型指纹；对外材料不附内部令牌、Cookie、原始用户录音或完整私有提示。

## 9. 私有声音克隆专项

本节只在 R2 执行。准备 A/B 两位已授权说话人的 WAV/MP3 与对应原文。录音大小 ≤10 MiB，解码后 3–30 秒；参考文本 1–2,000 字符；试听文本 1–120 字符。姓名和文件名可以使用代号。

### 9.1 正常流程

| 编号 | 操作 | 预期 |
| --- | --- | --- |
| V01 | 打开角色模板页“我的克隆声音”，上传 A 的录音，填写原话、语言和名称，勾选授权 | 保存成功，列表展示名称/时长/状态；刷新和重登后仍存在 |
| V02 | 对同一已上传素材重复保存相同名称、原文和语言 | 返回已有声音，不重复创建相同 profile；刷新重传文件是另一条上传记录，不混为同一请求 |
| V03 | 输入没有出现在参考录音中的新句子，合成试听 | 返回异步任务并生成可听 MP3；不是重播原录音，也不是测试蜂鸣音 |
| V04 | 保存 B 的声音，并分别给主持人/嘉宾绑定 A/B | 角色模板保存成功，`voice_id` 对应不同声音版本 |
| V05 | 用两个角色完成短文及长文脚本、确认并生成全文 | 两角色声音可区分，角色切换处没有串音；音频版本与任务保留正确声音版本及模型指纹 |
| V06 | 停用 A 的声音 | 不再出现在可选声音列表；不能提交新的试听/生成任务引用它；历史 MP3 仍可播放 |
| V07 | 恢复 A 的声音 | 可重新选择并提交任务 |
| V08 | 修改声音名称 | 不改变旧声音版本的录音/原文；改变素材需保存新声音，不能覆盖旧版本 |

声音停用不取消已经受理的任务：已受理任务按快照继续运行。这一点要与“停用后仍能新建任务”区分。

### 9.2 输入、权限及故障

| 编号 | 输入/操作 | 预期 |
| --- | --- | --- |
| V09 | 未勾授权、authorized=false 或数字 1 | 不允许创建；API 422 |
| V10 | too-short.wav / too-long.wav / silent.wav / broken.wav | 拒绝时长、接近静音或损坏输入；不创建可用声音 |
| V11 | over-limit.wav | 原始上传超过 10 MiB，413 `UPLOAD_TOO_LARGE` |
| V12 | 试听空文本或超过 120 字符 | 拒绝，不进入推理队列 |
| V13 | B 使用 A 的声音、参考 asset 或 profile ID | 列表不可见、详情不可读、绑定不可用，不泄露服务器文件路径 |
| V14 | 不带内部凭据调用 `/v1/clone`，但请求体格式合法 | 401；格式错误也可能先触发 422，不能据此判定鉴权已通过 |
| V15 | 通过错误 token 的独立 TTS 测试进程调用克隆 | 不合成、不回退 Mock；业务任务明确失败，检查 API/Worker/TTS 的 token 是否一致 |
| V16 | 用不存在的 Base 路径启动本轮 TTS | 进程可报告引擎未就绪；实际提交被拒绝或明确失败，不能返回假成功 |
| V17 | 参考素材缺失/哈希不符、模型在加载后发生改变 | 拒绝合成或要求重启；优先运行已有自动用例验证，不修改团队实际权重或用户素材来制造此故障 |

人工听感记录至少包含：与参考的音色相似程度、A/B 可区分性、中文数字/专名/英文混读、漏字/重复/截断、跨片段声线漂移及长段落衔接。团队若采用评分或时延阈值，在运行前约定；本文不把未测出的阈值写成已达标结果。

## 10. 任务、版本一致性与恢复

只对本轮隔离项目做故障注入。每个用例先记录 task_id、script_id、audio_version_id 和当前状态。

| 编号 | 操作 | 预期 |
| --- | --- | --- |
| Q01 | 完全相同的生成请求使用相同 Idempotency-Key 发两次 | 同一 task_id，无重复版本；queued/running 通常 202，终态重复请求可返回 200 |
| Q02 | 同一 key 改变请求正文 | 409 `IDEMPOTENCY_CONFLICT` |
| Q03 | 同项目任务运行中使用新 key 再提交 | `TASK_ALREADY_RUNNING`；不同项目也受总队列容量约束 |
| Q04 | 使用旧脚本 version/edit_revision 提交 | `REVISION_CONFLICT`；不能以旧声音/文本生成新音频 |
| Q05 | API 刷新或重启，Worker 不停 | 已排队/运行任务仍可按原 ID 查询，未因页面刷新丢单 |
| Q06 | 先停止本轮 Worker，提交任务为 queued，再启动 | 排队任务保留并被正常领取；不要把 queued 无限等待误判为模型失败 |
| Q07 | 本轮 Worker 在任务 running 时被强制终止，租约过期后重启 | 任务变为 failed，错误 `WORKER_INTERRUPTED`；项目活动任务解除，旧音频保留；不会自动重新运行旧任务 |
| Q08 | Q07 后用新 key 重新提交当前阶段 | 创建新任务，可恢复处理；使用旧 key 只返回旧终态任务 |
| Q09 | TTS/LLM 停止、不可用或返回错误 | 明确失败原因；不发布空音频、部分文件或伪装 Mock 成功；脚本和旧音频仍存在 |
| Q10 | 克隆试听失败及过期 | 无项目的 voice_preview 也能失败/恢复；过期 Worker 不能发布已失效结果 |
| Q11 | 声音/角色模板修改与已受理任务交错 | 任务使用受理时快照；版本详情足以追溯实际配置 |

本轮 Worker 的恢复操作：先确认 PID 文件来自第 4 节这一轮，检查进程，再只终止该 PID；不要使用 `pkill python`。

```bash
export PODCAST_WORKER_PID="$(cat "$PODCAST_ACCEPTANCE/worker.pid")"
ps -p "$PODCAST_WORKER_PID" -o pid,args
# Q07 使用；确认目标确为本轮 app.worker 后执行。
kill -KILL "$PODCAST_WORKER_PID"
```

等本轮 60 秒租约过期后，按第 4 节重启 Worker 并观察任务终态。租约续期/过期结果发布、并发领取、OOM、缓存和文件篡改等不便稳定人工制造的场景，以对应自动测试作为补充证据，不操作实际 GPU 权重制造故障。

HTTP 超时和前端轮询超时不等于模型已取消；先查原 task_id。模型仍忙时可能返回 engine_busy，不能立即同时堆入多个推理。更换 `.env`、token、模型或存储配置后，需要同步重启相应 API/Worker/模型进程，受理过的任务仍可能保留旧配置。

## 11. API 核验与证据采集

### 11.1 建立可复用的 A 会话

如果已经通过页面注册 A，只执行登录；否则先运行注册请求。这里使用 Vite 同源代理，避免 Cookie 的主机名和路径不一致。

```bash
# 首次注册；已注册时重复会 409，这是预期，随后正常登录即可。
curl --noproxy '*' -sS -H 'Content-Type: application/json' \
  --data-binary "@$PODCAST_ACCEPTANCE/register-a.json" \
  http://localhost:5173/api/auth/register \
  -o "$PODCAST_ACCEPTANCE/evidence/register-a.response.json"
curl --noproxy '*' -fsS -c "$PODCAST_ACCEPTANCE/qa-a.cookies" \
  -H 'Content-Type: application/json' \
  --data-binary "@$PODCAST_ACCEPTANCE/login-a.json" \
  http://localhost:5173/api/auth/login \
  -o "$PODCAST_ACCEPTANCE/evidence/login-a.response.json"
curl --noproxy '*' -fsS -b "$PODCAST_ACCEPTANCE/qa-a.cookies" \
  http://localhost:5173/api/v1/capabilities
```

登录响应及 Cookie 文件仅保留在私有验收目录；对外截图、HAR、报告需去掉 Cookie 和密码。B 会话使用 register-b/login-b 和独立 Cookie 文件。

### 11.2 固定一次生成请求，验证幂等

填入页面实际返回的整数脚本 ID、版本及修订号。必须先确认此脚本，并等待该项目已有任务结束。

```bash
export PODCAST_PROJECT_ID=1
export PODCAST_SCRIPT_ID=1
export PODCAST_SCRIPT_VERSION=1
export PODCAST_EDIT_REVISION=1
python - <<'PY'
import json, os
from pathlib import Path
Path(os.environ["PODCAST_ACCEPTANCE"], "audio-request.json").write_text(json.dumps({
    "script_id": int(os.environ["PODCAST_SCRIPT_ID"]),
    "expected_script_version": int(os.environ["PODCAST_SCRIPT_VERSION"]),
    "expected_edit_revision": int(os.environ["PODCAST_EDIT_REVISION"]),
}), encoding="utf-8")
PY

# 连续执行两次，保持 URL、正文和 key 完全相同，分别保存响应供比较。
curl --noproxy '*' -sS -b "$PODCAST_ACCEPTANCE/qa-a.cookies" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: acceptance-audio-001' \
  --data-binary "@$PODCAST_ACCEPTANCE/audio-request.json" \
  "http://localhost:5173/api/v1/projects/$PODCAST_PROJECT_ID/audio/generate"
```

任务查询、脚本详情、分段列表和音频版本详情分别来自：

```text
GET /api/v1/tasks/{task_id}
GET /api/v1/projects/{project_id}/tasks
GET /api/v1/scripts/{script_id}
GET /api/v1/projects/{project_id}/source/chunks
GET /api/v1/audio-versions/{audio_version_id}
```

API JSON 中的业务 ID 使用正整数；前端显示为字符串不意味着接口接受 `"1"` 这样的字符串型 body ID。需要业务完整协议时查看 `http://127.0.0.1:8001/docs`，不要把旧静态 API 文档中的预留路径当成已实现功能。

### 11.3 只读检查本轮数据库

下面操作只读取本轮数据库，输出摘要到 evidence，不导出密码、Cookie 或参考转写文本。

```python
import hashlib
import json
import os
from pathlib import Path
import sqlite3

run = Path(os.environ["PODCAST_ACCEPTANCE"])
db = sqlite3.connect((run / "generation.sqlite3").resolve().as_uri() + "?mode=ro", uri=True)
db.row_factory = sqlite3.Row
report = {}
for name in ("projects", "source_chunks", "scripts", "audio_versions", "tasks", "assets", "voice_profiles", "voice_versions"):
    report[name + "_count"] = db.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
report["schema_revision"] = db.execute("SELECT version_num FROM alembic_version").fetchone()[0]
report["script_providers"] = []
for row in db.execute("SELECT id, llm_snapshot FROM scripts ORDER BY id"):
    snapshot = json.loads(row["llm_snapshot"])
    report["script_providers"].append({"script_id": row["id"],
        "provider": snapshot.get("llm_config", {}).get("provider"),
        "simulated": snapshot.get("simulated")})
report["audio_integrity"] = []
for row in db.execute("SELECT id, object_key, size_bytes, sha256, duration_ms FROM assets WHERE kind IN ('full_audio','voice_preview') AND status='ready'"):
    path = (run / "assets" / row["object_key"]).resolve()
    assert path.is_relative_to((run / "assets").resolve())
    content = path.read_bytes()
    report["audio_integrity"].append({"asset_id": row["id"],
        "size_matches": len(content) == row["size_bytes"],
        "sha256_matches": hashlib.sha256(content).hexdigest() == row["sha256"],
        "positive_duration": row["duration_ms"] > 0})
report["foreign_key_errors"] = [tuple(r) for r in db.execute("PRAGMA foreign_key_check")]
db.close()
(run / "evidence" / "database-summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
```

预期 schema_revision 为 `20261114_voice_cloning`，外键检查无错误；ready 音频大小、SHA256 和正时长校验均成立。脚本提供方与本轮模式一致。若资源故障测试故意删除了文件，先标记该用例，不能用这些故障数据签收正常完整性；建议在正常流程完成后采集一次，再进行故障测试。

## 12. 性能、体验与验收材料

### 12.1 本轮必须记录的指标

| 指标 | 记录方法 |
| --- | --- |
| 提交响应时间 | Network 中脚本/音频/试听 POST 的耗时，区分任务受理和实际完成 |
| 冷启动 | 模型未加载时首个有效请求到首个音频完成 |
| 热推理 | 相同长度新文本的第二次生成；缓存参考 prompt 与首次构建分开记录 |
| 长文耗时 | 各阶段开始/结束、片段数、最终台词长度和总耗时 |
| 真实语音性能 | 推理耗时、音频时长，以及 RTF=推理耗时/音频时长；与冷启动、编码耗时分开 |
| GPU/内存 | 模型加载前后、并存及推理期间的峰值；缺少监控记录为未测 |
| 页面体验 | Chrome/Edge 上输入、上传、刷新恢复、长文进度、错误提示、播放暂停/拖动和下载 |

本版本尚未给出经过实测的性能承诺。验收前由团队填写时延、显存和目标时长偏差阈值；没有阈值时只能提交测量报告，不能宣称满足尚未定义的性能 SLA。

### 12.2 每条用例的记录格式

```text
用例编号：
代码 HEAD / 分支 / 工作区差异：
运行模式 / 浏览器 / Python、Node 和依赖版本：
模型 ID、部署指纹 / 参考声音代号及授权记录位置：
项目 ID / 脚本 ID、版本、修订 / 任务 ID / 音频版本 ID / 资产 ID：
执行步骤与输入：
预期结果：
实际结果：
证据文件、日志 request_id、截图和音频哈希：
结果：通过 / 失败 / 阻塞 / 未执行
缺陷编号或范围调整依据：
执行人 / 复核人 / 日期：
```

证据至少保留：Git 版本、环境及模式、配置的脱敏摘要、自动检查输出、账号及权限结果、短文/长文关键页面、原文/分段摘要、脚本和任务版本、音频元数据与哈希、解码结果、真实听感记录、故障恢复结果。服务日志由各启动终端另行保存到本轮 logs；除 Worker 外本文命令默认前台输出，不假定日志已自动落盘。

## 13. 完成判定与收尾

### 13.1 分别给出三项结论

1. **当前代码功能验收**：当前支持范围内的必测用例无未解决失败，版本和用户隔离正确，故障不会发布假成功。仅完成 M1/M2 时必须写清“Mock 管线验收”。
2. **真实模型与克隆验收**：R1/R2 及长文联合流程实际完成，正文、人声和说话人相似度经人工复核，有模型、声音版本、音频及性能证据。缺权重、授权录音或实机执行则为阻塞。
3. **原需求全量验收**：逐项对照 FR01–FR12。FR05 等必须项仍有未实现差距时，不能写“全部通过”；需补实现，或提供经团队确认的范围调整记录。

### 13.2 收尾

- 停止本轮启动的前端、API、模型服务和 Worker，确认端口释放；不停止其他成员进程。
- 本轮原文、录音、Cookie、数据库、密钥和成品保留在忽略目录，由资料所有者决定保留周期；不提交到 Git。
- 执行 `git status --short`，应只有明确要提交的代码/文档；不能包含验收秘密、音频或权重。
- 修复缺陷后复验相关用例，再保留最终记录；提交功能分支，PR 目标仍为 `integration/final`。
- 另行部署到服务器、LAN 或生产环境时，需要为该部署单独验收反向代理、访问控制和浏览器 Cookie。本文只签收本机 localhost 拓扑，不将 Vite 开发服务视为生产部署。

当前已有验证证据见 [合并记录](integration-sync-20261114.md)、[克隆验证记录](voice-cloning-validation.json)。它们不替代本轮填写的人工验收单。
