# 用户登录与管理模块接口说明

负责人可在本文档基础上与项目、脚本、音频、语料和声音模块联调。对应需求为 FR13、FR14。

## 会话约定

- API 根路径为 `/api`。
- 登录成功后，服务端设置名为 `textcast_session` 的 HttpOnly Cookie。
- 前端请求必须使用 `credentials: include`；公共请求封装已经统一设置。
- 会话默认有效期为 8 小时，禁用账户或重置密码会立即撤销该用户的全部会话。
- 系统不提供公开注册。所有账户由管理员创建。
- 时间统一返回 UTC ISO 8601 字符串。

统一错误格式：

```json
{
  "code": "INVALID_CREDENTIALS",
  "message": "用户名或密码错误",
  "details": null
}
```

`details` 没有内容时可以省略。调用方应主要判断稳定的 `code`，将 `message` 展示给用户。

## 登录与当前用户

### 注册

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "alice",
  "displayName": "Alice",
  "password": "UserPass123!"
}
```

注册账号固定为普通启用用户，成功返回 `201`、设置会话 Cookie 并返回与登录相同的数据结构。失败码包括 `USERNAME_EXISTS`、`CREDENTIAL_INVALID` 和 `REGISTRATION_DISABLED`。是否开放注册由 `TEXTCAST_ALLOW_REGISTRATION` 控制。

### 登录

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "alice",
  "password": "UserPass123!"
}
```

成功返回 `200`：

```json
{
  "user": {
    "id": "6b168bf5-bae4-42e0-a81f-4034dbf34578",
    "username": "alice",
    "displayName": "Alice",
    "role": "user",
    "status": "active",
    "createdAt": "2026-10-22T01:00:00Z",
    "updatedAt": "2026-10-22T01:00:00Z",
    "lastLoginAt": "2026-10-22T01:05:00Z"
  },
  "expiresAt": "2026-10-22T09:05:00Z"
}
```

失败码：`INVALID_CREDENTIALS`、`ACCOUNT_DISABLED`。

### 查询当前用户

```http
GET /api/auth/me
```

成功返回 `{ "user": User }`；未登录返回 `AUTH_REQUIRED`，过期或被撤销返回 `SESSION_INVALID`。

### 更新显示名称

```http
PATCH /api/auth/me
Content-Type: application/json

{ "displayName": "新的显示名称" }
```

### 修改自己的密码

```http
POST /api/auth/change-password
Content-Type: application/json

{
  "currentPassword": "旧密码",
  "newPassword": "新的强密码"
}
```

成功后撤销其他会话，为当前设备签发新会话。失败码包括 `CURRENT_PASSWORD_INVALID`、`PASSWORD_INVALID` 和 `PASSWORD_UNCHANGED`。

### 退出

```http
POST /api/auth/logout
```

成功返回 `204 No Content`。重复退出也是安全操作。

## 管理员用户接口

以下接口均要求当前用户角色为 `admin`，否则返回 `ADMIN_REQUIRED`。

| 方法与路径 | 用途 | 成功响应 |
| --- | --- | --- |
| `GET /api/admin/users` | 查询用户；支持 `search`、`role`、`status` | `{ users, total }` |
| `POST /api/admin/users` | 创建用户 | `201 { user }` |
| `PATCH /api/admin/users/{userId}` | 修改显示名称、角色或状态 | `{ user }` |
| `POST /api/admin/users/{userId}/reset-password` | 管理员重置密码并撤销该用户会话 | `204` |

创建用户请求：

```json
{
  "username": "alice",
  "displayName": "Alice",
  "password": "UserPass123!",
  "role": "user",
  "status": "active"
}
```

更新请求只传需要变化的字段：

```json
{
  "role": "admin",
  "status": "active"
}
```

安全约束：管理员不能修改自己的角色或状态；系统不能失去最后一个启用的管理员；禁用用户和重置密码都会撤销既有会话；不提供物理删除用户接口，以免破坏项目、脚本和审计记录的归属关系。

## 其他模块接入方式

前端直接复用：

```ts
import { useAuth } from "@/features/auth/AuthProvider"

const { user } = useAuth()
// user.id、user.role、user.displayName
```

后端 FastAPI 路由直接复用：

```python
from fastapi import Depends
from app.dependencies import get_current_user, require_admin

def normal_endpoint(user = Depends(get_current_user)):
    owner_user_id = user["id"]

def admin_endpoint(admin = Depends(require_admin)):
    actor_user_id = admin["id"]
```

项目、脚本、任务、语料、纠错、声音样本和音频表都应保存 `owner_user_id`。查询、更新和下载时使用会话内的用户 ID 作为必需条件，例如 `WHERE id = ? AND owner_user_id = ?`，不能仅根据资源 ID 查询。

当前实现说明：正式 SQLite 暂时只有用户、会话和审计表；项目、脚本和音频仍由前端 Mock 提供，尚未完成 `owner_user_id` 数据隔离。其他模块接入正式后端时必须补齐此约束。

## 开发 Mock

前端开发环境启用 MSW 时提供与正式后端相同的接口。仅用于本地页面开发：

- 管理员：`admin / TextCast123!`
- 普通用户：`demo / TextCast123!`

Mock 密码不属于正式系统账号。关闭 Mock 后必须使用数据库中的真实账户。
