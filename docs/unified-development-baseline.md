# 统一开发分支基线

`integration/final` 是第一阶段统一开发分支，基于最新 `main`，合入账号后端、生成后端、本地 LLM/TTS 服务和已有联调成果。

## 唯一入口与服务边界

| 目录 | 职责 | 默认端口 |
| --- | --- | --- |
| `frontend/` | 唯一 Web 前端 | 5173 |
| `backend/` | 账号、会话和管理员服务 | 8000 |
| `generation-backend/` | 项目、脚本、任务、音频和 Worker | 8001 |
| `llm/` | 本地脚本生成模型服务 | 建议 8003 |
| `tts/` | 本地语音合成服务 | 8002 |

`backend/prototype/` 仅保留为早期教学演示，不参与正式链路。

## 当前统一决策

1. 采用 `main` 中的新前端 API 类型和页面，不回退到旧 TextCast 页面。
2. 采用 `backend/` 负责账号、`generation-backend/` 负责生成业务的双后端结构。
3. 采用 `generation-backend/app/integrations/` 作为 LLM/TTS Adapter 边界。
4. `llm/` 与 `tts/` 使用独立 Python 环境和独立进程，不共用依赖环境。
5. 开发默认允许 Mock；真实模型是否完成以端到端验收和 `real_speech` 元数据为准。
6. 不再维护旧 `PodcastWorkflow`、旧 `request.ts` 或第二套前端认证状态。
7. `feat/backend-tts-integration` 的 `llm/`、`tts/` 文件树已包含在本分支；该分支的另一套 `backend/` 不整包合入，避免覆盖账号服务。

## 第一阶段完成标准

- 所有有效模块位于同一分支且无 Git 冲突。
- 前端只有一套入口、路由、API 客户端和 Mock。
- 每个 Python 服务职责和端口明确。
- CI 覆盖前端、账号后端、生成后端、LLM 和 TTS 的无模型测试。
- 已知接口差异以 Issue/文档记录，不以复制第二套实现规避。

真实 Qwen 模型权重、音质和完整端到端验收属于后续阶段，不作为本阶段完成的假设。
