# 文字转播客生成系统

本仓库将中文原文转换为可审核的播客脚本，再生成可播放和下载的音频。

当前统一开发基线为 `integration/final`。新功能应从该分支创建功能分支，并通过 Pull Request 合回 `integration/final`；完成真实端到端验收后再合入 `main`。

## 统一目录

```text
text-to-podcast/
├─ frontend/             唯一 Web 前端（React + TypeScript）
├─ backend/              账号、会话和管理员服务（FastAPI，端口 8000）
├─ generation-backend/   项目、脚本、任务、音频和 Worker（端口 8001）
├─ llm/                  本地大模型脚本服务（建议端口 8003）
├─ tts/                  本地语音服务（端口 8002）
├─ backend/prototype/    早期教学 Demo，不参与正式链路
└─ docs/                 需求、接口、测试和模型资料
```

架构决策与模块边界见 [`docs/unified-development-baseline.md`](docs/unified-development-baseline.md)。

## 推荐：浏览器按钮测试

在仓库根目录只启动一次控制台：

```bash
python scripts/local_console.py
```

打开 **http://localhost:8765**，按页面按钮检查/安装开发环境、初始化隔离数据、启动全部服务、执行各模块测试和短文/长文闭环，直接查看日志、脚本、报告及音频。Windows 也可双击 `start-local.bat`；Linux/WSL 可运行 `bash start-local.sh`。

业务前端为 **http://localhost:5173**，控制台启动的隔离库管理员是 `admin / TextCast123!`。M1/M2 使用测试音；真实模型需要准备权重和独立环境，再选择 R1/R2。完整说明见 [本地控制台指南](docs/local-console.md)，本次代码评估和实测见 [可行性检查](docs/feasibility-review.md)。

当前版本从环境准备、隔离数据、服务启动到长文、声音克隆和异常恢复的完整验收步骤见 [完整验收流程](docs/acceptance-workflow.md)。

## 先运行前端 Mock

需要 Node.js 22.12+、pnpm 11+。

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

默认启用 MSW，暂时不依赖 Python 服务，适合开发页面和确认业务流程。

提交前执行：

```powershell
cd frontend
pnpm check
```

## 连接真实服务

四个 Python 服务必须使用各自的虚拟环境，不要把依赖安装到同一个环境。

账号服务和生成服务的基础启动方式：

```powershell
# 窗口 1：账号服务
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
# 窗口 2：生成 API
cd generation-backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m app.bootstrap
$env:TEXTCAST_AUTH_URL='http://127.0.0.1:8000'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

```powershell
# 窗口 3：脚本 Worker
cd generation-backend
$env:TEXTCAST_AUTH_URL='http://127.0.0.1:8000'
.\.venv\Scripts\python.exe -m app.worker --queue script
```

```powershell
# 窗口 4：音频与声音试听 Worker
cd generation-backend
$env:TEXTCAST_AUTH_URL='http://127.0.0.1:8000'
.\.venv\Scripts\python.exe -m app.worker --queue audio
```

前端连接真实服务时创建 `frontend/.env.local`：

```env
VITE_ENABLE_MOCK=false
```

LLM/TTS 的模型准备、独立环境和启动方式见 [`docs/local-llm.md`](docs/local-llm.md)、[`docs/local-qwen.md`](docs/local-qwen.md) 与 [`docs/model-setup.md`](docs/model-setup.md)。

## 当前完成情况

- 最新前端已成为唯一入口，旧版登录页、旧 API 客户端和旧工作流已移除。
- 账号后端、生成后端、LLM 和 TTS 服务代码已位于同一开发分支。
- 前端 lint、单元测试、TypeScript 和生产构建已纳入检查。
- CI 已覆盖前端、账号后端、生成后端、LLM 和 TTS 的无模型检查。
- 支持粘贴或上传最长 100,000 字符的 TXT/Markdown，按自然段或预计朗读时长预览并保存有序分段。
- 默认模型流程仍允许 Mock；真实 Qwen 权重和音质不因代码合并而自动视为通过。

## 下一阶段已知工作

语音克隆功能分支已补充私有声音库、Base 引擎、角色绑定与任务快照接线，部署与验证边界见 [语音克隆说明](docs/voice-cloning.md)。真实 Base 模型音质仍需专项验收。

- 本功能分支已对齐账号响应与字段命名，并为 Cookie 写请求添加来源校验。
- 在真实服务模式下跑通登录、项目、脚本、确认、音频生成、播放和下载。
- 已合入长文本自动分段、全局大纲、携带前文记忆的分节生成和统一润色；真实模型对长文的事实准确性、衔接及耗时仍需专项验收，单次模型输入及最终台词仍限制 5,000 字。
- 修复或固定 Python 测试依赖，确保所有 CI 任务稳定通过。
- `feat/backend-tts-integration` 保留为历史参考；其 `llm/`、`tts/` 源码与本基线一致，不再整包合并以免覆盖账号后端。

协作约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md)，原始需求见 [`docs/文字转播客生成系统_产品需求规格说明书.docx`](docs/文字转播客生成系统_产品需求规格说明书.docx)。

## 脚本模式与双主持人

生成弹窗支持“提示词创作 / 保留原文 / 长文概括”、0.5B / 4B 模型选择，以及预设主持人 A/B 单人或双人播报。更新与模型下载步骤见 [脚本模式说明](docs/script-generation-modes.md)。

TTS 现支持 0.6B / 1.7B CustomVoice 与可选 CUDA Graph 加速后端；控制台提供硬件检测、模型规格和后端选择。安装与实测数据见 [TTS 性能升级](docs/tts-performance-upgrade.md)。
