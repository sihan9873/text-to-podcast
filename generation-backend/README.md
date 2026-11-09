# 文字转播客后端框架

已实现最小闭环：创建项目 → 提交原文 → 异步生成脚本 → 查看并确认 → 异步生成完整音频 → 下载 MP3。两个生成方法默认分别执行 `time.sleep(10)`，然后返回内置测试结果，不调用真实 LLM / TTS。

当前音频是约 3 秒的测试音，**不是脚本朗读**。测试脚本、生成接口提示及音频元数据均标明模拟结果。

项目设计与交接资料见 [docs](docs/)，包含 API 文档、数据库文档、阶段说明及 OpenAPI 文件。这些资料包含规划内容，可能与当前实现存在差异；实际已实现接口和 ID 参数类型以本 README 及运行时 `/openapi.json` 为准。

## 启动

克隆仓库后，在 PowerShell 中进入仓库根目录，使用 Python 3.12：

```powershell
git clone https://github.com/Cabite/text-to-podcast-backend.git
cd text-to-podcast-backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m app.bootstrap
```

默认使用 SQLite，无需启动数据库服务，也不需要 Redis。初始化命令会执行 Alembic 迁移，创建固定开发用户、模拟模型和一个主持人角色，可重复执行。每位成员会在自己的 `data/` 目录创建独立数据库，不需要复制他人的数据库文件。可选地复制 `.env.example` 为 `.env` 修改配置；不要覆盖已有配置。API、Worker 和初始化命令均在仓库根目录执行，确保相对配置路径一致。

终端一启动 API：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

终端二启动独立 Worker：

```powershell
cd text-to-podcast-backend
.\.venv\Scripts\python.exe -m app.worker
```

浏览器打开 <http://127.0.0.1:8000/docs> 查看当前已实现接口；<http://127.0.0.1:8000/openapi.json> 可导入 Apifox。Swagger UI 的静态资源需要联网加载，接口本身不依赖外网。

只有 API 启动时可以提交、查询任务，但任务会排队，必须启动 Worker 才会执行。初期建议一个 Worker 进程；每个 Worker 顺序执行任务。

## 已实现接口

统一前缀 `/api/v1`。业务 JSON 响应包含 `code`、`message`、`data`、`request_id`、`timestamp`；健康检查和音频二进制响应例外。实际参数结构以运行时 OpenAPI 为准。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/health/live` | API 存活检查，兼容旧 `/api/health/live` |
| GET | `/health/ready` | 数据库连接及初始化检查，不代表 Worker 已在线 |
| POST | `/projects` | 通过 `title` 创建项目 |
| GET | `/projects` | 分页查询项目，支持标题关键字 |
| GET | `/projects/{project_id}` | 查询原文、当前/已确认脚本、最新音频及进行中任务 |
| PUT | `/projects/{project_id}/source` | 通过 `text` 提交并锁定原文，最多 5000 字符 |
| GET | `/roles` | 查询固定测试角色，取得 `profile_id` |
| POST | `/projects/{project_id}/script/generate` | 提交脚本生成任务，返回 202 和 `task_id` |
| GET | `/tasks/{task_id}` | 轮询任务状态、错误及结果 |
| GET | `/scripts/{script_id}` | 查询脚本、角色及有序脚本句 |
| POST | `/scripts/{script_id}/confirm` | 校验版本和编辑修订号，确认脚本 |
| POST | `/projects/{project_id}/audio/generate` | 为已确认脚本提交完整音频任务，返回 202 |
| GET | `/audio-assets/{asset_id}/play` | 播放 MP3，支持 Range 请求 |
| GET | `/audio-assets/{asset_id}/download` | 下载 MP3 |

脚本生成请求体：

```json
{"roles":[{"profile_id":1,"role_key":"host"}]}
```

确认脚本请求体：

```json
{"expected_script_version":1,"expected_edit_revision":1}
```

音频生成请求体：

```json
{"script_id":1,"expected_script_version":1,"expected_edit_revision":1}
```

业务 ID 均为数据库自动分配的正整数，每张表分别递增；新数据库的开发用户、模型和角色配置 ID 均为 `1`。例如项目详情为 `/api/v1/projects/1`，生成脚本的角色配置传 `"profile_id": 1`。请求体中的 ID 必须是 JSON 数字，不要加引号；上方音频示例的 `script_id: 1` 需按实际生成结果填写。请求追踪 `request_id`、文件存储名、Worker 租约令牌仍使用随机字符串，不属于业务主键；模型厂商自己的 `voice_id` 等外部标识保持原格式。

版本和修订号应从脚本详情读取。两个生成接口必须携带 `Idempotency-Key` 请求头：相同用户、相同键和相同请求复用原任务；同键不同请求返回 409。新一次生成需使用新键。同一项目同时只允许一个生成任务。幂等键可用 `script-test-001` 等普通字符串，不要求 UUID。

首次脚本任务完成后，从任务 `data.result.script_id` 获取脚本 ID；音频任务完成后，从 `data.result.download_url` 获取下载路径。状态为 `queued` / `running` 时继续轮询，为 `failed` 时读取 `error_code` 和 `error_message`。

## 自动验证

运行自动测试（测试注入零延迟服务以缩短耗时，同时单独校验默认延迟为 10 秒）：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

不需要手动启动服务的实际 HTTP 闭环验证：

```powershell
.\.venv\Scripts\python.exe scripts\smoke_test.py --start-local
```

该命令使用隔离的临时数据库、动态本地端口、独立 API 和 Worker，实际等待两次 10 秒，检查生成时 API 仍可响应，最后关闭测试进程。下载结果与测试报告保存在 `data/smoke-result/`。也可以对已启动的本地服务执行 `python scripts/smoke_test.py`；此模式会在该服务数据库中创建测试项目。

测试素材位于 `fixtures/test_script.json`、`fixtures/test_audio.mp3` 和 `fixtures/test_audio.metadata.json`。运行模拟服务无需安装 FFmpeg。

## 目录与成员接入位置

```text
app/
  api/             HTTP 路由、参数接收、开发用户依赖
  core/            配置、统一响应与业务异常
  db/              ORM、会话、固定开发数据
  services/        项目、脚本确认、查询组装
  integrations/    生成服务协议与 10 秒模拟实现
  jobs/            数据库任务队列、结果落库
  worker.py        独立 Worker 入口
  storage.py       本地文件存储与路径检查
  bootstrap.py     迁移和开发数据初始化
migrations/        Alembic 数据库迁移
fixtures/          固定测试脚本及可播放 MP3
tests/             自动测试
scripts/           实际 HTTP 闭环验证
data/              默认数据库、生成音频和测试输出（不提交版本库）
```

LLM 成员实现 `integrations/contracts.py` 的 `ScriptGenerator.generate(snapshot)`，返回 `GeneratedScript`；TTS 成员实现 `AudioGenerator.generate(snapshot)`，返回 `GeneratedAudio`。在 `Worker` 初始化时注入实现，即可替换模拟类。模型输入使用任务提交时保存的快照；成员专注生成逻辑，统一由任务处理器负责数据库和文件发布。

数据库包含用户、模型、角色配置、项目、脚本、脚本角色、脚本句、任务、音频版本、资源共 10 张表。脚本重新生成新增版本；确认时检查并发修订并限制一个项目仅一版已确认脚本；完整音频生成新增版本并保存脚本、模型/语音配置快照。

任务先入库，由 Worker 定期领取；领取和结果发布带状态校验、租约与执行令牌。Worker 意外退出后，过期运行任务由下一次 Worker 扫描标记失败并释放项目；已排队任务保留。失败后可使用新幂等键重新提交当前阶段，目前没有专门的任务重试接口。

## 数据库配置与当前范围

`.env` 可将 `DATABASE_URL` 切换为 MySQL 8：

```dotenv
DATABASE_URL=mysql+pymysql://textcast:change-me@127.0.0.1:3306/textcast?charset=utf8mb4
```

先创建数据库和账户，再执行 `python -m app.bootstrap`。切换连接不会搬迁 SQLite 中的数据。当前实际运行测试使用 SQLite；MySQL 初始迁移做了离线 DDL 校验，整数模型做了 DDL 编译校验，尚未连接 MySQL 实例验证。ID 数据迁移必须在线运行，不支持用 `alembic upgrade head --sql` 导出后离线转换现有数据。

### 从 UUID 版本升级

1. 停止 API 和所有 Worker，避免迁移期间旧进程继续读写。
2. 若有 `.env`，将 `DEVELOPMENT_USER_ID` 改为 `1`。
3. 在仓库根目录执行 `python -m app.bootstrap`，然后重新启动 API 和 Worker。

迁移保留现有项目、脚本、音频文件、任务以及表之间的关联，并转换 JSON 快照里的业务 ID、播放下载路径和幂等请求签名。旧 UUID URL 将失效，请重新查询项目列表并更新 Apifox 的路径参数、请求体及环境变量；也可从运行中的 `/openapi.json` 重新导入整数类型定义。

升级现有 SQLite 数据库时，初始化命令会先在数据库所在目录的 `backups/` 下生成完整旧库备份，升级成功后在旁边保存 `.mapping.json`，记录各表旧 UUID 到新整数的映射。SQLite 迁移事务失败会回滚，不会清空旧数据；需要回退代码时使用旧库备份恢复，不支持自动降级 ID 迁移。MySQL 的 DDL 不具备相同事务回滚保证，已有 MySQL 数据应先使用数据库备份工具完成备份，再升级。

当前使用固定开发用户，尚未实现登录鉴权、TXT 上传、脚本编辑/取消确认、历史版本列表、试听、逐句合成与重新生成、声音克隆、模型密钥管理等接口。服务默认仅监听本机，用于团队联调；后续可以沿现有路由、服务、迁移和生成协议补充业务。原有核心 API 设计文档保持原样，不能将完整设计中的全部接口视为已实现。

`requirements.txt` 为运行依赖，`requirements-dev.txt` 增加测试依赖；`requirements.lock` 固定本次验证的完整开发环境版本。
