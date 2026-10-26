# TextCast 正式后端

正式后端采用 FastAPI 和 SQLite。当前已实现 FR13、FR14：登录、服务端会话、个人资料、修改密码、管理员创建及维护账户、禁用账户、重置密码和角色权限校验。

`prototype/` 是早期音频流程演示，与本目录的正式 API 相互独立。

## 先确认要查看哪种运行效果

### 仅查看页面和交互（Mock 模式）

前端开发环境默认使用 Mock 接口，不需要启动正式后端。在仓库根目录执行：

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

管理员演示账号为 `admin / TextCast123!`，普通用户演示账号为
`demo / TextCast123!`。Mock 数据只保存在浏览器内存中，刷新开发服务后可能重置。

### 查看真实数据库和接口（联调模式）

前端和后端是两个持续运行的进程，必须分别使用两个 PowerShell 窗口：

1. 第一个窗口启动后端，保持该窗口运行。
2. 第二个窗口启动前端，保持该窗口运行。
3. 不要把后端命令粘贴到已经运行 Vite 的窗口中。

按照下文完成后端安装和启动后，在 `frontend/.env.local` 中写入：

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
VITE_ENABLE_MOCK=false
```

Vite 只在启动时读取环境变量，因此修改后必须在前端窗口按 `Ctrl+C` 停止旧进程，
再运行 `pnpm dev`。要切回 Mock 模式，删除 `frontend/.env.local` 并重启前端。

## 安装与启动

在仓库根目录执行：

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements-dev.txt
```

首次运行可使用环境变量创建初始管理员：

```powershell
$env:TEXTCAST_BOOTSTRAP_ADMIN_USERNAME="admin"
$env:TEXTCAST_BOOTSTRAP_ADMIN_PASSWORD="替换为至少8位的强密码"
$env:TEXTCAST_BOOTSTRAP_ADMIN_DISPLAY_NAME="系统管理员"
cd backend
uvicorn app.main:app --reload --port 8000
```

管理员只会在空数据库中创建一次。也可以在 `backend/` 目录运行交互式命令：

```powershell
python -m app.cli create-admin --username admin --display-name 系统管理员
```

接口文档地址为 `http://127.0.0.1:8000/docs`。前端关闭 Mock 后连接此服务：

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api
VITE_ENABLE_MOCK=false
```

## 验证

```powershell
cd backend
pytest
```

数据库文件、真实密码及环境变量文件不得提交到 Git。

## 供其他模块使用的权限依赖

正式业务接口必须声明当前用户依赖，并用返回的 `id` 限制数据库查询：

```python
from fastapi import Depends
from app.dependencies import get_current_user

@router.get("/projects")
def list_projects(user = Depends(get_current_user)):
    return repository.list_projects(owner_user_id=user["id"])
```

管理员接口使用 `require_admin`。普通业务接口不得接受前端传入的 `userId` 作为数据归属依据，必须使用会话中的当前用户 ID。

完整契约见 `../docs/user-management-api.md`。
