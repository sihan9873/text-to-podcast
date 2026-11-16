# 私有声音克隆：使用与部署

实现分支：`feat/voice-cloning`，基于 `integration/final@203799f`。设计背景见 [实施计划](voice-cloning-plan.md)。

## 当前可用的代码流程

登录 → 角色模板页的“我的克隆声音” → 上传 WAV/MP3 → 填写录音原文并确认声音使用授权 → 保存 → 输入新文本试听 → 新建角色模板并选择克隆声音 → 创建项目、提交原文 → 选择角色生成脚本 → 审核、确认 → 生成全文音频 → 播放/下载 MP3。

首版使用 Qwen3-TTS **Base**，可让不同角色绑定不同克隆声音。CustomVoice 预设声音流程保留，但同一个 TTS 进程不同时启用两套模型；预设与克隆混用尚未实现。克隆不需要训练，不包含自动转写或浏览器录音。录音原文由用户填写，须与录音一致。

## 部署前提

- FFmpeg 可执行文件需支持 WAV/MP3 解码和 libmp3lame 编码。
- TTS 使用已有兼容的 Qwen SDK / PyTorch 环境和本地 Base 权重；不得将 CustomVoice 路径当作 Base 使用。服务不会自动下载模型。
- 账号、生成服务、LLM、TTS 保持独立进程与环境。浏览器只访问前端的同源 `/api`。
- 本版本参考素材通过同机私有目录共享：TTS 进程只需读取权限，API 负责写入。API、Worker、TTS 的 `VOICE_REFERENCE_DIR` 填写同一绝对路径。
- API、Worker、TTS 的 `TTS_INTERNAL_TOKEN` 使用相同随机秘密值；只配置在服务端，不能放入 `VITE_*`、请求快照或提交源码。可在本机运行 `python -c 'import secrets; print(secrets.token_urlsafe(32))'` 生成，再填入各自未跟踪的环境文件。

## 配置示例

将示例中的路径和秘密值替换为本机配置。生成后端 `.env`（API 和 Worker 都会读取）：

```dotenv
TEXTCAST_AUTH_URL=http://127.0.0.1:8000
LOCAL_LLM_BASE_URL=http://127.0.0.1:8003
LLM_PROVIDER=mock
AUDIO_PROVIDER=local_http
LOCAL_TTS_BASE_URL=http://127.0.0.1:8002
LOCAL_TTS_ENGINE_ID=qwen3-base
VOICE_REFERENCE_DIR=/absolute/path/to/generation-backend/data/voice-references
TTS_INTERNAL_TOKEN=<同一个本机秘密值>
FFMPEG_BINARY=ffmpeg
```

`LLM_PROVIDER=mock` 只用于验证合成接线，此时脚本为明确标注的预置测试台词。真实内容生成需另行配置 `LLM_PROVIDER=local_http` 并启动 LLM 服务。

TTS 进程环境：

```dotenv
TTS_ENABLE_QWEN=0
TTS_ENABLE_QWEN_BASE=1
TTS_QWEN_BASE_MODEL_PATH=/absolute/path/to/Qwen3-TTS-12Hz-0.6B-Base
TTS_QWEN_DEVICE=cuda:0
TTS_QWEN_DTYPE=bfloat16
TTS_QWEN_MAX_TEXT_CHARS=120
TTS_QWEN_MAX_NEW_TOKENS=2048
VOICE_REFERENCE_DIR=/absolute/path/to/generation-backend/data/voice-references
TTS_INTERNAL_TOKEN=<同一个本机秘密值>
```

TTS 配置由进程环境读取。使用 shell 导出，或在本机配置文件中正确引用包含空格的路径；不要直接 `source` 上面的占位符。若使用自己的 `.env`，先在 TTS shell 中逐行执行 `set -a`、`. ./.env`、`set +a`，再启动服务。

账号服务先启动；在各自环境、各自目录执行：

```bash
# backend/
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# generation-backend/：先迁移，再分别启动 API、脚本 Worker 和音频 Worker
python -m app.bootstrap
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
python -m app.worker --queue script
python -m app.worker --queue audio

# tts/，显式导出上述环境变量后
python -m uvicorn tts_service.configured:configured_app --factory --host 127.0.0.1 --port 8002
```

前端 `frontend/.env.local`：`VITE_ENABLE_MOCK=false`。重启 Vite，使用 `http://localhost:5173` 访问，保持当前 Cookie 代理域一致。开发 Mock 模式中声音库不保存录音、不伪造克隆结果。

多用户部署必须设置 `TEXTCAST_AUTH_URL`；未设置时生成后端仍沿用仓库原有的固定开发身份，仅供单用户本地调试。当前账号 API 保持原有响应，前端客户端负责转换；写请求采用 Cookie SameSite 和 Origin / Fetch Metadata 来源校验，未伪造 CSRF token。

## API 与内部边界

业务接口都通过当前用户鉴权：

| 接口 | 请求 / 行为 |
| --- | --- |
| `POST /api/v1/voice-references` | 原始 WAV/MP3 请求体，最大 10 MiB；返回 `asset_id`、`duration_ms` |
| `POST /api/v1/voice-profiles` | JSON：`name`、`reference_asset_id`、`reference_text`、`language`（Chinese/English）、`authorized:true` |
| `GET /api/v1/voice-profiles` | 当前用户列表，`data.items` |
| `GET /api/v1/voice-profiles/{id}` | 当前用户声音详情 |
| `PATCH /api/v1/voice-profiles/{id}` | 只可修改名称、启用/停用状态，不覆盖录音或原文 |
| `POST /api/v1/voice-profiles/{id}/preview` | JSON `text`（1–120 字符）及 `Idempotency-Key`，返回任务 ID |
| `GET /api/v1/tasks/{id}` | 包含 `voice_preview` 任务；其 `project_id=null` |
| `GET /api/v1/voices` | 当前部署可选音色，克隆项只属于当前用户 |
| `POST/PATCH/DELETE /api/v1/roles...` | 角色模板持久化、归属检查与配置校验；删除采用停用以保留历史引用 |
| `GET /api/v1/capabilities` | 告知前端试听、逐句音频和克隆能力；未实现的逐句入口不显示 |

上传拆成原始音频请求和 JSON 资料请求，避免新增 multipart 依赖；前端保留已上传素材的 ID 供保存失败时重试。同一素材、名称、原文和语言重复保存返回已有声音。未创建声音的上传素材仍占录音配额。

内部 `POST /v1/clone` 需要 `Authorization: Bearer ...`。Worker 发送受控相对对象键、SHA256、声音版本 ID 对应的 `voice_id`、参考文本和模型指纹；不接受浏览器任意文件路径或 URL。返回经过校验的 PCM WAV，再由已有生成器切块拼接、转为可解码 MP3。

声音试听复用原数据库任务表、租约、心跳和恢复流程，不依附虚构项目，不建立 Redis/Celery 队列。重复请求不会创建重复任务，过期 Worker 无法发布结果。首次推理才加载模型；参考 prompt 只在进程内缓存，最多 8 项，不读取用户提供的序列化模型文件。

## 数据和版本规则

- 录音只接受可解码 WAV/MP3，转换为 24 kHz、单声道、PCM16 WAV；解码后须为 3–30 秒，接近静音的输入拒绝。输入格式强制固定，FFmpeg 禁止从录音中加载外部协议资源。
- `VoiceProfile` 负责名称和状态，`VoiceVersion` 保存不可变素材引用、原文、语言和授权时间。首版修改录音/原文需另存新声音。
- 模板、脚本、任务和音频版本保留声音版本引用；任务额外冻结录音哈希、原文和模型部署指纹。修改模板不影响已有脚本，编辑脚本需先取消确认并增加修订号。
- 声音停用后阻止新任务选择；已受理任务按快照执行，历史 MP3 保留播放。首版仅提供停用，不物理删除被历史记录引用的声音。
- 模型指纹结合配置内容及本地权重/分词器文件元数据，用于检测部署变化，并非模型文件的密码学完整性清单。加载后替换文件会拒绝合成并要求重启，防止已载入旧模型冒充新版本。
- 每个用户最多 20 个声音、40 条参考上传；同时有两个排队/运行任务时暂停提交试听。生产配额与未引用素材清理可在下一阶段扩展。
- 迁移 `20261114_voice_cloning` 增加声音表、允许试听任务无项目，并保留任务状态约束。存在声音或试听数据时拒绝有损降级。升级现有数据库前应保留备份。

## 验证命令与边界

```bash
# frontend/
pnpm check

# backend/ 与 generation-backend/ 各自环境
python -m pytest -q

# tts/ 与 llm/ 的轻量环境
python -m unittest discover -s tests -v
```

新增测试覆盖上传解码、静音/超时长拒绝、授权、跨用户隔离、双角色克隆请求、可解码完整 MP3、声音版本快照、脚本修订、试听幂等、重启保留和失效租约拒绝发布；TTS 使用明确的 SDK 替身验证参数、延迟加载、缓存隔离、模型变更和内部鉴权。

这些测试中的合成替身和测试信号仅验证协议与管线，**不构成真实克隆音质验收**。本次没有安装/下载权重、升级 CUDA/PyTorch 或读取用户录音。本机只发现 CustomVoice 权重，Base 权重及授权样本仍待提供；真实 GPU 推理、音色相似度、显存峰值、冷启动与热推理耗时、浏览器完整交互仍需实测。

合并 `integration/final@0ca2ed8` 后，长文自动保存分段及多阶段脚本生成已与克隆链路接通。生成后端 48 项、LLM 5 项、TTS 29 项通过，1 项真实模型测试跳过；前端 22 项测试、类型检查和生产构建通过，lint 无错误。账号服务沿用前次 18 项通过记录。复用本机既有依赖，未重新安装锁定版本；测试环境的线程唤醒问题用临时测试辅助解决。详细范围和版本记录见 [验收记录](voice-cloning-validation.json) 与 [本次集成同步记录](integration-sync-20261114.md)。
