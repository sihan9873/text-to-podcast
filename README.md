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
# 窗口 3：生成 Worker
cd generation-backend
$env:TEXTCAST_AUTH_URL='http://127.0.0.1:8000'
.\.venv\Scripts\python.exe -m app.worker
```

前端连接真实服务时创建 `frontend/.env.local`：

```env
VITE_ENABLE_MOCK=false
```

LLM/TTS 的模型准备、独立环境和启动方式见 [`docs/local-llm.md`](docs/local-llm.md)、[`docs/local-qwen.md`](docs/local-qwen.md) 与 [`docs/model-setup.md`](docs/model-setup.md)。

## 当前完成情况

- 最新前端已成为唯一入口，旧版登录页、旧 API 客户端和旧工作流已移除。
- 账号后端、生成后端、LLM 和 TTS 服务代码已位于同一开发分支。
- 前端 lint、11 项测试、TypeScript 和生产构建通过。
- CI 已覆盖前端、账号后端、生成后端、LLM 和 TTS 的无模型检查。
- 默认模型流程仍允许 Mock；真实 Qwen 权重和音质不因代码合并而自动视为通过。

## 下一阶段已知工作

- 对齐新前端与账号服务的认证响应、字段命名和 CSRF 契约。
- 在真实服务模式下跑通登录、项目、脚本、确认、音频生成、播放和下载。
- 修复或固定 Python 测试依赖，确保所有 CI 任务稳定通过。
- `feat/backend-tts-integration` 保留为历史参考；其 `llm/`、`tts/` 源码与本基线一致，不再整包合并以免覆盖账号后端。

协作约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md)，原始需求见 [`docs/文字转播客生成系统_产品需求规格说明书.docx`](docs/文字转播客生成系统_产品需求规格说明书.docx)。
