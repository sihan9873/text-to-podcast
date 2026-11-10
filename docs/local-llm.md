# 本地 Qwen 脚本模型

采用官方 [Qwen/Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct)，
0.49B 参数，Apache-2.0，固定提交 `7ae557604adf67be50417f59c2c2f167def9a775`。
这是用于跑通业务的小模型，不保证事实正确、长脚本质量或严格满足时长/句数要求。
模型输出通过 JSON/字段/角色/长度校验后才发布，人工审核确认后才进入 TTS。

```text
自然语言描述 → 原文提交接口 → 脚本任务快照 → 数据库 Worker
  → ScriptGenerator（LocalLLMScriptGenerator）→ HTTP :8002
  → 独立 Qwen LLM 服务 → GeneratedScript → 原发布器入库
  → 查看并确认脚本 → 原音频任务 → HTTP TTS :8001 → 完整 MP3
```

## 1. 模型和环境

本次已经下载到 `llm/models/Qwen2.5-0.5B-Instruct/`，共 999,602,607 字节。
该目录中的 `download-manifest.json` 记录固定提交、文件大小和 SHA256；权重、缓存、
环境不提交 Git。下载脚本可断点复用同版本文件，不会在服务启动时下载。

本机使用独立 Conda 环境 `podcast-llm`，从已有 `podcast-tts` 离线克隆，
保留已验证的 torch/transformers/FastAPI 版本，不修改原环境，不重新安装 CUDA/PyTorch。
后端仍在 `podcast-backend`，轻量 TTS 在 `podcast-tts-service`，进程间只通过 HTTP 通信。

相同机器首次创建环境（已有环境时跳过）：

```bash
conda create -n podcast-llm --clone podcast-tts --offline -y
```

其他机器建议准备独立 `podcast-llm` Conda 环境，由部署者先准备适合 GPU/驱动的
PyTorch，再安装 `llm/requirements.txt`。不要往业务环境安装模型 SDK，
不要为了本项目自动升级已有 CUDA/PyTorch。

本机重新下载命令（在仓库根目录；只有显式执行此命令才联网）：

```bash
conda run --no-capture-output -n podcast-llm python llm/scripts/download_model.py
```

## 2. 启动 LLM 服务

终端 L，从 `llm/` 运行模块：

```bash
cd /你的路径/text-to-podcast/llm
LLM_DEVICE=cuda:0 conda run --no-capture-output -n podcast-llm python -m uvicorn llm_service.app:app \
  --host 127.0.0.1 --port 8002 --workers 1
```

默认使用本服务目录下的模型；可通过 `LLM_MODEL_PATH` 设置已有模型的绝对路径。
CPU 运行需显式设置 `LLM_DEVICE=cpu`，使用 float32，速度另行验收。
模型仅在首次生成时加载；加载只允许本地文件，禁止远程代码和隐式下载。
health 不导入 torch/transformers，列表只检查本地文件和加载状态。
推理发生在运行该服务的机器，调用端不执行模型推理。

```bash
curl --noproxy '*' http://127.0.0.1:8002/health
curl --noproxy '*' http://127.0.0.1:8002/v1/models
conda run --no-capture-output -n podcast-llm python scripts/demo_llm_service.py \
  --description '写一段双人中文播客，给初学者介绍太阳系，语气轻松。'
```

接口为 `POST /v1/scripts/generate`，请求字段见 `llm_service/app.py` 及运行时
`/docs`。返回 `{model_id, simulated: false, script: {title, summary, sentences}}`。
角色采用稳定的 `role_key`，服务不接受数据库 ID 或音色配置，不导入后端业务代码。

## 3. 连接业务后端

在 backend 的 `.env` 中设置下列值，保留数据库、存储和已有 TTS 配置。
也可以在启动 bootstrap/API/Worker 的各终端中 export 同名变量。
shell 环境变量优先于 `.env`；三者必须读取相同配置。

```dotenv
LLM_PROVIDER=local_http
LOCAL_LLM_BASE_URL=http://127.0.0.1:8002
LOCAL_LLM_MODEL_ID=Qwen/Qwen2.5-0.5B-Instruct
LOCAL_LLM_TIMEOUT_SECONDS=300
LOCAL_LLM_MAX_NEW_TOKENS=1536
```

然后在 `backend/` 执行，初始化仅增量注册模型，不覆盖旧 Mock 模型或用户资产：

```bash
conda run --no-capture-output -n podcast-backend python -m app.bootstrap
```

分别启动（或重启）业务 API 和 Worker：

```bash
conda run --no-capture-output -n podcast-backend python -m uvicorn app.main:app \
  --host 127.0.0.1 --port 8000
```

```bash
conda run --no-capture-output -n podcast-backend python -m app.worker
```

`Settings()` 的代码默认保留 Mock；部署示例 `.env.example` 已选择真实 Qwen。
实际 `.env` 需设置 `local_http` 才调用 Qwen。
本阶段模型由部署配置统一选择：新项目关联对应模型；旧项目重新提交脚本时也使用
当前部署选择的模型。已排队任务保留提交时的地址、模型、提示词和输出预算，
不会因重启或后续 `.env` 修改而切换模型。历史脚本不变。
切回 Mock 后的新脚本使用原 Mock 模型记录。

### 本机统一启动、检查和停止

本机已创建 `backend/.env` 并启用真实 Qwen LLM 和 Qwen TTS。完整命令与两者区别见
[本机真实 Qwen 指南](local-qwen.md)。
在 Linux/WSL 且用户级 systemd 可用时，从仓库根目录执行：

```bash
conda run --no-capture-output -n podcast-backend python scripts/local_services.py start
conda run --no-capture-output -n podcast-backend python scripts/local_services.py status
conda run --no-capture-output -n podcast-backend python scripts/local_services.py stop
```

`start` 使用用户级临时单元 `text-to-podcast-local.service` 托管 API、Worker、
LLM 和所配置的 TTS，等待 HTTP 健康检查通过后返回。它不会设置开机自启。
启动前检查8000/8001/8002端口，使用各自 Conda 环境，增量执行 bootstrap。
已有托管服务时不重复启动；日志与 PID 信息保存在 `outputs/local-services/`。
进程退出时托管器停止同组进程，再由 systemd 按失败策略重启。

```bash
systemctl --user status text-to-podcast-local.service
journalctl --user -u text-to-podcast-local.service -n 50
```

没有 systemd 的机器可在终端运行 `python scripts/local_services.py run`
（通过 `conda run -n podcast-backend` 选择解释器），保持该终端运行；
或者按上面各模块的命令分别启动。工具执行会话中的普通后台子进程不能保证在会话
结束后存活，因此需要系统服务管理器或用户自己的持续运行终端。
统一启动工具支持默认端口下的真实 Qwen TTS 和显式 Mock TTS。真实 TTS 使用
`podcast-tts` 并读取 `tts/.env`；Mock 使用 `podcast-tts-service`。

## 4. 输入自然语言并生成音频

继续使用已有接口，无需另建任务队列或修改 TTS：

1. `POST /api/v1/projects` 创建项目。
2. `PUT /api/v1/projects/{id}/source` 提交 `{"text":"写一段双人播客，介绍太阳系，语气轻松。"}`。
   这里既可以输入素材，也可以输入自然语言创作要求；提交后沿用原有不可修改约束。
3. `GET /api/v1/roles` 获取实际角色 ID。若要继续生成音频，应选当前 TTS 模型的
   本地角色，而不是旧固定测试音角色。
4. `POST /api/v1/projects/{id}/script/generate`，携带 `Idempotency-Key`，
   body 为 `{"roles":[{"profile_id":实际ID,"role_key":"host_a"}, ...]}`。
5. 轮询返回的任务地址，成功后读取 `GET /api/v1/scripts/{script_id}`。
6. 审核标题、事实内容和台词；使用实际 version/edit_revision 确认脚本。
7. 沿用原音频生成、任务轮询、播放和下载接口。若 TTS 仍为 Mock，只会生成音调。

已有服务启动后，也可以从根目录使用完整业务验证工具（会创建新联调项目）：

```bash
conda run --no-capture-output -n podcast-tts-service python scripts/verify_backend_flow.py \
  --engine-id qwen3-customvoice --task-timeout 1800 \
  --description '写一段双人播客，介绍太阳系，语气轻松。'
```

`--engine-id` 选择 TTS 引擎，不是 LLM。后端 `LOCAL_TTS_ENGINE_ID` 必须同样为
`qwen3-customvoice`；统一启动工具会选择真实 TTS 环境与 configured factory。
LLM 与 TTS 会共享同一 GPU 的显存，请保持各一个服务进程。

## 5. 错误、限制与验证

输入最多5000字符，最多8个角色；输出最多2048新 token（默认1536）。
服务以贪心解码生成，允许一层 JSON Markdown 包裹，但不修补损坏/截断 JSON。
空白台词、缺角色/多角色、超长或额外字段均拒绝。模型格式或语义效果不稳定时，
可缩短要求后以新幂等键提交；不自动重试、不返回 Mock 冒充真实结果。

错误会映射为 `LLM_UNAVAILABLE`、`LLM_TIMEOUT`、`LLM_ENGINE_BUSY`、
`LLM_MODEL_UNAVAILABLE`、`LLM_MODEL_LOAD_FAILED`、`LLM_OUT_OF_MEMORY`、
`LLM_OUTPUT_TRUNCATED`、`LLM_INVALID_RESPONSE` 等，Worker 标记失败并释放项目。
HTTP 超时不会取消已经开始的 GPU 推理；请先查看原任务状态。
脚本快照 `simulated=false`；后续音频元数据的 `script_simulated=false` 与
音频自身的 `simulated` 分别表示 LLM 与 TTS 是否真实运行。

无模型测试：

```bash
cd backend
conda run --no-capture-output -n podcast-backend python -m pytest -q
cd ../llm
conda run --no-capture-output -n podcast-llm python -m unittest discover -s tests -v
```

真实模型 + TCP + 后端数据库 + Mock TTS 闭环（自动启动并关闭临时服务，
使用临时数据库，不触碰既有数据；从仓库根运行）：

```bash
conda run --no-capture-output -n podcast-backend python scripts/verify_local_llm.py
```

输出报告为 `outputs/llm-verification/report.json`。本次验收记录见
[llm-validation.json](llm-validation.json)。该验证不代表真实 TTS 听音验收。
这条隔离验证专门测试 LLM 接入，仍使用 Mock TTS；完整真实模型链路请使用上面的
`verify_backend_flow.py --engine-id qwen3-customvoice`。
验证工具默认从 `podcast-llm` 和 `podcast-tts-service` 分别解析解释器；
可用 `--llm-env`、`--tts-env` 指定其他 Conda 环境。
默认仅监听127.0.0.1，无正式鉴权；LAN 部署必须显式配置访问控制。
