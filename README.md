# 文字转播客生成系统

本仓库是小组项目的统一代码库。系统目标是将中文原文转换为经过人工审核的播客脚本，再生成可播放、可下载的音频。

正式业务流程：

```text
导入/粘贴原文
  -> 大模型生成播客脚本
  -> 用户审核、编辑并确认脚本
  -> 选择音色、风格和语速
  -> 生成、播放和下载音频
```

## 目录结构

```text
text-to-podcast/
├─ frontend/           TextCast 前端项目
├─ backend/
│  ├─ app/             FastAPI 正式后端
│  ├─ tests/           正式后端自动化测试
│  └─ prototype/       Python 离线流程演示，不是正式后端
├─ docs/               需求、分工、审核与联调文档
├─ .github/            CI 和 Pull Request 模板
├─ CONTRIBUTING.md     团队协作规范
└─ README.md
```

## 运行前端

需要 Node.js 22.12+ 和 pnpm 11+。

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

打开终端输出的本地地址。开发环境默认启用 MSW 模拟接口，因此暂时不需要运行后端。

提交前检查：

```powershell
cd frontend
pnpm check
```

前端的页面、数据流和当前限制见 [`frontend/README.md`](frontend/README.md) 与 [`docs/frontend-review.md`](docs/frontend-review.md)。

## 运行后端原型

需要 Python 3.10+，离线模式无第三方依赖。

```powershell
cd backend\prototype
python test_demo.py
python server.py
```

该原型有自己的简单演示页面，只用于说明任务提交、状态轮询和音频获取过程，不能直接充当正式前端的后端。

## 运行正式后端

正式后端已经实现登录、会话和管理员用户管理。安装、初始管理员创建及联调方式见 [`backend/README.md`](backend/README.md)，接口契约见 [`docs/user-management-api.md`](docs/user-management-api.md)。

## 项目资料

- [`docs/文字转播客生成系统_产品需求规格说明书.docx`](docs/文字转播客生成系统_产品需求规格说明书.docx)：需求基线。
- [`docs/frontend-review.md`](docs/frontend-review.md)：TextCast 前端审核结论。
- [`docs/integration-plan.md`](docs/integration-plan.md)：前后端接口和实施顺序。
- [`docs/source-input-module.md`](docs/source-input-module.md)：原文输入规则、接口和验收记录。
- [`docs/user-management-requirements.md`](docs/user-management-requirements.md)：用户管理详细需求和验收标准。
- [`docs/user-management-api.md`](docs/user-management-api.md)：用户管理接口契约。
- [`docs/user-management-technical-report.md`](docs/user-management-technical-report.md)：用户管理技术实现通俗说明。
- [`docs/weekly-report-user-management.md`](docs/weekly-report-user-management.md)：用户管理模块周记草稿。
- [`docs/分工.md`](docs/分工.md)：当前小组分工记录。

## 当前状态

- TextCast 前端可以启动和构建，现阶段主要由 Mock 数据驱动。
- 用户登录、个人资料和管理员用户管理具有前端、Mock 与 FastAPI/SQLite 正式接口。
- 原文输入前端已支持 TXT/UTF-8/100 KB 校验、编辑、字数提示、超长确认、API 保存和自动化测试。
- “提交给 AI 修改”尚未调用真实大模型。
- 脚本保存和确认仍有前端缓存操作，需要改为服务端持久化。
- 试听、真实 TTS、数据库、受控下载和部署尚未完成。
- `backend/prototype` 默认只生成一秒测试音，不朗读正文。

开发新功能前请先阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 公共基础设施开发基线

新增业务开发请先阅读 [架构与模块边界](docs/architecture.md)、[数据库设计](docs/database-design.md) 和 [API 实施契约](docs/api-contract.md)。第一批正式接口为登录后的 `POST /api/v1/projects` 与 `GET /api/v1/projects/{project_id}`，已支持数据库持久化及用户数据隔离。任务、模型与文件存储接口目前为设计边界，尚未实现。

## 本地联调生成播客

使用三个 PowerShell 窗口，从本仓库根目录分别执行下面的命令，再在第四个窗口启动 Worker。

```powershell
# 窗口 1，账号服务
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
# 窗口 2，生成 API
cd generation-backend
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m app.bootstrap
$env:TEXTCAST_AUTH_URL = 'http://127.0.0.1:8000'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

```powershell
# 窗口 3，前端
cd frontend
pnpm install
pnpm dev
```

```powershell
# 窗口 4，Worker
cd generation-backend
.\.venv\Scripts\python.exe -m app.worker
```

打开前端终端显示的地址。注册并登录后，打开「全部项目」，点击「新建项目」，在项目详情里提交原文、确认脚本、合成并下载 MP3。生成项目使用框架自己的数据库，登录服务通过会话校验提供账号身份。前端通过 Vite 代理访问两个服务。设置 TEXTCAST_AUTH_URL 后生成 API 要求有效会话。独立模拟测试可在未设置该变量的窗口使用固定开发用户。

Worker 使用框架自带的模拟服务，输出为测试音。全部项目、新建项目和项目详情共用生成数据库。账号库中的历史项目没有迁移。
