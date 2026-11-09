# 文字转播客系统 API 文档

## 1 公共接口约定

### 1.1 路径、认证与参数

- 以下路径均包含 `/api/v1` 前缀；JSON 字段使用 `snake_case`，时间使用 ISO 8601 UTC。
- 所有资源 ID 均为后端生成的 UUID。示例使用合法 UUID；路径中的 ID 不由前端推算。
- 注册、登录无需已有会话；其余接口均需登录。服务端根据会话确定用户，不接受请求体指定数据所有者。
- 登录成功设置 `podcast_session` HttpOnly Cookie，Path=/api/v1，生产环境使用 Secure、SameSite=Lax；退出清除时使用相同 Path。前端请求携带 Cookie；跨域部署只允许配置中的前端来源，前后端采用同站部署以符合 Cookie 策略。
- 登录和当前用户接口返回 `csrf_token`；已登录的 POST、PUT、PATCH、DELETE 请求携带 `X-CSRF-Token`。它与当前会话绑定，可由服务端签名派生，无需增加数据库字段。注册、登录校验 Origin 并实施频率限制。
- 除上传外，请求使用 `Content-Type: application/json`。无请求体的 POST 不要求发送 `{}`。
- 创建脚本／音频任务、任务重试及采用候选的异步请求必须携带 `Idempotency-Key`，长度 1—128。相同用户、同键、同一路径及请求内容返回原处理结果；同键不同请求返回 `409 IDEMPOTENCY_CONFLICT`。通过 tasks 保存幂等键与包含请求路径的摘要。新操作使用新键，网络重发沿用旧键；同步保留原片段按候选状态实现幂等，不要求此请求头。
- 任何资源均校验用户归属。资源不存在或属于他人时统一返回 `404 RESOURCE_NOT_FOUND`；不以知道 ID、文件名或路径作为授权依据。

本版参数校验建议基线：标题 1—100 字符，原文与脚本总正文各不超过 5000 字符，单句正文 1—1000 字符，TXT 不超过 100 KiB，仅支持 UTF-8／UTF-8 BOM。字符数按 Unicode 码点统计，正文换行统一为 LF，不静默截断。团队如调整限额，应同时修改前后端 Schema 和本文。

列表公共参数：`page` 为整数，默认 1、最小 1；`page_size` 默认 20，范围 1—100。返回 `items`、`page`、`page_size`、`total`；默认按 `created_at DESC, id DESC` 稳定排序。脚本句和音频句段按 `sequence ASC` 返回完整清单，不分页。

### 1.2 响应格式

除音频文件成功响应外，统一使用以下外壳。后文的“返回 data”只描述其中的 `data`，实际响应不得省略外壳。

```json
{
  "code": "OK",
  "message": "success",
  "data": {},
  "request_id": "d1f8b5c7-7c90-4000-8000-000000000001",
  "timestamp": "2026-11-05T08:00:00Z"
}
```

**公共响应外壳：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `code` | string | 否 | 成功为 OK，失败为稳定业务错误码 |
| `message` | string | 否 | 可读提示，前端不依赖文本判断业务分支 |
| `data` | object / array | 是 | 业务数据，失败时为 null |
| `request_id` | string | 否 | 请求追踪标识 |
| `timestamp` | datetime | 否 | 服务器响应时间，UTC |

字段表中“可为空”表示允许值为 null，所有列出的固定字段仍需返回；父对象为 null 时不展开其子字段。`items[].x`、`roles[].x` 等表示数组元素字段，动态参数与快照对象按接口中引用的结构解释。不同任务成功 result 只返回对应类型的字段。

失败使用对应 HTTP 状态，`data` 为 null：

```json
{
  "code": "REVISION_CONFLICT",
  "message": "脚本内容已更新，请刷新后重新审核",
  "data": null,
  "request_id": "d1f8b5c7-7c90-4000-8000-000000000002",
  "timestamp": "2026-11-05T08:00:00Z"
}
```

| HTTP | 使用情形 |
| --- | --- |
| 200 | 查询、同步修改、幂等确认或原结果返回 |
| 201 | 创建账户、项目、凭据或角色 |
| 202 | 后台任务已受理，尚未完成 |
| 400 / 422 | 请求格式错误／字段或业务参数校验失败 |
| 401 / 403 | 未登录或会话失效／CSRF 或明确操作权限失败 |
| 404 | 资源不存在或无权访问 |
| 409 | 输入已锁定、版本冲突、确认冲突或任务冲突 |
| 413 / 415 | 上传过大／文件类型不支持 |
| 429 | 请求过于频繁 |
| 500 / 503 | 内部错误／提交时必要服务不可用 |

任务已经返回 202 后发生的 LLM、TTS 或合并错误，通过任务的 failed 状态及错误字段返回；轮询接口正常查询到失败任务时仍为 HTTP 200。

### 1.3 版本与异步受理

| 字段 | 含义 |
| --- | --- |
| `script_id`、`version` | 一次 LLM 生成的脚本及项目内版本号；重新生成新增，手动保存不变 |
| `edit_revision` | 同一脚本的内部修订号；手动有效保存递增，初始 1 |
| `audio_version_id`、`version` | 一次正式完整生成的音频版本；试听不分配，单句重生成不递增 |
| `selection_revision` | 音频版本当前结果的内部修订号；首次成功为 1，成功采用新片段并重新合并后递增 |
| `expected_*` | 前端回传刚读取的版本／修订，供后端校验；前端不能自行增加 |

原文不建立版本，首次提交后锁定。脚本状态为 `draft`、`confirmed`。同项目最多一版 confirmed；新生成脚本不自动替换旧版确认。

异步接口统一返回以下 data，未取得的 ID 为 null，不能省略必有字段：

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `task_id` | UUID | 否 | 当前生成或合并操作的任务 ID |
| `task_type` | string | 否 | script 或 audio |
| `audio_action` | string | 是 | preview、full、regenerate；脚本任务为 null |
| `status` | string | 否 | 首次受理为 queued，幂等重放为原任务当前状态 |
| `script_id` | UUID | 是 | 来源或结果脚本 ID；脚本生成首次受理时为 null |
| `audio_version_id` | UUID | 是 | 正式音频版本 ID；脚本生成和试听为 null |
| `candidate_id` | UUID | 是 | 候选 ID；无候选的任务为 null |
| `status_url` | string | 否 | 任务详情查询路径 |

示例：

```json
{
  "task_id": "99999999-9999-4999-8999-999999999999",
  "task_type": "audio",
  "audio_action": "full",
  "status": "queued",
  "script_id": "22222222-2222-4222-8222-222222222222",
  "audio_version_id": "88888888-8888-4888-8888-888888888888",
  "candidate_id": null,
  "status_url": "/api/v1/tasks/99999999-9999-4999-8999-999999999999"
}
```

`task_type` 为 script 或 audio；脚本任务 `audio_action` 为 null，音频任务为 preview、full 或 regenerate。创建脚本任务时 script_id 为 null，成功后才分配结果脚本。首次受理为 queued；同幂等键重放可能返回原任务的当前状态。202 表示已受理，既有终态任务的幂等查询返回 200。

## 2 用户模块

### U-01 注册

`POST /api/v1/auth/register`

**功能：** 创建普通用户，不自动登录。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `username` | string | 是 | 3—64 位字母、数字、下划线；转小写后保存 |
| `password` | string | 是 | 8—128 字符，服务端不截断 |
| `display_name` | string / null | 否 | 昵称，1—100 字符；省略或 null 表示未设置 |

**返回：** HTTP 201。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `user_id` | UUID | 否 | 用户 ID |
| `username` | string | 否 | 规范化后的登录名 |
| `display_name` | string | 是 | 用户昵称，未设置为 null |
| `status` | string | 否 | active 或 disabled |
| `created_at` | datetime | 否 | 账户创建时间 |

不返回密码或密码散列。

**数据库逻辑：** 校验参数后散列密码，插入 users；唯一索引处理并发重名。重名返回 `409 USERNAME_EXISTS`。

### U-02 登录

`POST /api/v1/auth/login`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `username` | string | 是 | 登录名，按注册时的规则规范化 |
| `password` | string | 是 | 用户密码，服务端不截断 |

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `user` | object | 否 | 当前用户信息，子字段如下 |
| `expires_at` | datetime | 否 | 当前会话过期时间 |
| `csrf_token` | string | 否 | 后续写请求使用的 CSRF Token |
| `user.user_id` | UUID | 否 | 用户 ID |
| `user.username` | string | 否 | 规范化后的登录名 |
| `user.display_name` | string | 是 | 用户昵称，未设置为 null |
| `user.status` | string | 否 | active 或 disabled |
| `user.created_at` | datetime | 否 | 账户创建时间 |

同时设置会话 Cookie，不在 JSON 中返回会话原文。

**数据库逻辑：** 查询 users、校验密码及 active 状态，向 user_sessions 写入会话凭据摘要与过期时间。用户名或密码错误统一返回 `401 INVALID_CREDENTIALS`；Cookie 中的随机凭据不明文存数据库。

### U-03 当前用户

`GET /api/v1/auth/me`

**参数：** 无。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `user` | object | 否 | 当前用户信息，子字段如下 |
| `expires_at` | datetime | 否 | 当前会话过期时间 |
| `csrf_token` | string | 否 | 后续写请求使用的 CSRF Token |
| `user.user_id` | UUID | 否 | 用户 ID |
| `user.username` | string | 否 | 规范化后的登录名 |
| `user.display_name` | string | 是 | 用户昵称，未设置为 null |
| `user.status` | string | 否 | active 或 disabled |
| `user.created_at` | datetime | 否 | 账户创建时间 |

**数据库逻辑：** 根据 Cookie 摘要查询 user_sessions，检查未撤销且未过期，再检查 users.status。过期、撤销或账户不可用返回 401，不泄露具体认证信息。

### U-04 退出

`POST /api/v1/auth/logout`

**请求体：** 无。请求头携带当前 Cookie 和 CSRF Token。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `logged_out` | boolean | 否 | 成功退出时为 true |

同时清除会话 Cookie。

**数据库逻辑：** 设置当前 user_sessions.revoked_at。重复退出已撤销／过期会话可直接返回成功并清 Cookie；无有效会话时不撤销其他会话。

## 3 项目模块

### P-01 创建项目

`POST /api/v1/projects`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 是 | 项目标题，1—100 字符 |

仅创建项目，不在此接口提交原文。

**返回：** HTTP 201。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `project_id` | UUID | 否 | 新项目 ID，前端据此进入详情 |
| `title` | string | 否 | 项目标题 |
| `source_submitted` | boolean | 否 | 新项目为 false |
| `created_at` | datetime | 否 | 创建时间 |
| `updated_at` | datetime | 否 | 更新时间 |

**数据库逻辑：** 插入 projects，user_id 来自会话；source_text、source_type、source_submitted_at、current_script_id 初始为空。

### P-02 项目列表

`GET /api/v1/projects`

**查询参数：** 公共分页参数；`keyword: string` 可选，最多 100 字符，对标题做文字匹配，不将 `%`、`_` 当作用户通配指令。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `items` | array | 否 | 当前页记录，无记录时为 [] |
| `page` | integer | 否 | 当前页码 |
| `page_size` | integer | 否 | 每页条数 |
| `total` | integer | 否 | 符合条件的总记录数 |
| `items[].project_id` | UUID | 否 | 项目 ID |
| `items[].title` | string | 否 | 项目标题 |
| `items[].source_submitted` | boolean | 否 | 原文是否已经提交并锁定 |
| `items[].current_script_id` | UUID | 是 | 默认展示脚本 ID |
| `items[].confirmed_script_id` | UUID | 是 | 当前已确认脚本 ID，无确认时为 null |
| `items[].latest_audio_version_id` | UUID | 是 | 最新分配的正式音频版本 ID |
| `items[].created_at` | datetime | 否 | 创建时间 |
| `items[].updated_at` | datetime | 否 | 更新时间 |

**数据库逻辑：** projects 按当前 user_id 查询；确认脚本由 scripts.status 查询，最新音频按 audio_versions.version 查询。列表不返回原文全文或密钥。

### P-03 项目详情

`GET /api/v1/projects/{project_id}`

**路径参数：** `project_id: UUID`。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `project_id` | UUID | 否 | 项目 ID |
| `title` | string | 否 | 项目标题 |
| `source_text` | string | 是 | 已提交原文，未提交时为 null |
| `source_type` | string | 是 | text 或 txt，未提交为 null |
| `source_asset_id` | UUID | 是 | 保留的 TXT 资产 ID，未保留为 null |
| `source_hash` | string | 是 | 正文摘要 |
| `source_submitted` | boolean | 否 | 原文是否已经提交并锁定 |
| `source_submitted_at` | datetime | 是 | 原文提交时间 |
| `llm_config` | object | 否 | 项目 LLM 配置，字段见 C-10 返回表 |
| `current_script` | object | 是 | 默认展示脚本摘要，不等于已确认脚本 |
| `current_script.script_id` | UUID | 否 | 默认展示脚本 ID |
| `current_script.version` | integer | 否 | 展示版本 |
| `current_script.edit_revision` | integer | 否 | 内部修订号 |
| `current_script.status` | string | 否 | draft 或 confirmed |
| `confirmed_script` | object | 是 | 当前确认脚本摘要，无确认时为 null |
| `confirmed_script.script_id` | UUID | 否 | 已确认脚本 ID |
| `confirmed_script.version` | integer | 否 | 已确认脚本展示版本 |
| `confirmed_script.edit_revision` | integer | 否 | 已确认脚本内部修订号 |
| `confirmed_script.confirmed_at` | datetime | 否 | 当前确认时间 |
| `latest_audio` | object | 是 | 最新分配的正式音频版本，可能失败或尚未完成 |
| `latest_audio.audio_version_id` | UUID | 否 | 正式音频版本 ID |
| `latest_audio.version` | integer | 否 | 音频版本号 |
| `latest_audio.status` | string | 否 | queued、running、ready、failed |
| `latest_audio.selection_revision` | integer | 否 | 当前选用修订号 |
| `latest_audio.current_asset_id` | UUID | 是 | 当前完整 MP3 资产，未就绪为 null |
| `active_tasks` | array | 否 | 本项目 queued／running 的任务摘要，无任务为 [] |
| `created_at` | datetime | 否 | 创建时间 |
| `updated_at` | datetime | 否 | 更新时间 |
| `active_tasks[].task_id` | UUID | 否 | 任务 ID |
| `active_tasks[].task_type` | string | 否 | script 或 audio |
| `active_tasks[].audio_action` | string | 是 | 音频操作类型；脚本任务为 null |
| `active_tasks[].stage` | string | 否 | 当前执行阶段 |
| `active_tasks[].status_url` | string | 否 | 查询任务详情的路径 |

**数据库逻辑：** 鉴权后读取 projects，关联 scripts、audio_versions、tasks；只返回当前用户资源。前端使用 active_tasks 恢复轮询，不依赖缓存保存任务 ID。脚本全文通过 S-03 获取。

### P-04 确认提交文本原文

`PUT /api/v1/projects/{project_id}/source`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `text` | string | 是 | 用户确认提交的原文，按公共正文限制校验 |

不接受 source_version，也不接受 user_id。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `project_id` | UUID | 否 | 项目 ID |
| `source_text` | string | 否 | 已保存原文 |
| `source_type` | string | 否 | text 或 txt，取决于提交接口 |
| `source_asset_id` | UUID | 是 | 上传 TXT 资产 ID；文本提交为 null |
| `source_hash` | string | 否 | 规范化正文摘要 |
| `source_submitted` | boolean | 否 | 成功提交后为 true |
| `source_submitted_at` | datetime | 否 | 原文提交并锁定的时间 |

本接口 source_type 固定为 text，source_asset_id 固定为 null。

**数据库逻辑：** 锁定 projects 行，确认 source_submitted_at 为空，一次写入正文、类型、摘要及提交时间。已提交时返回 `409 SOURCE_LOCKED`，即使新正文相同也不覆盖。仅标题项目允许首次提交。

### P-05 上传 TXT 并提交原文

`POST /api/v1/projects/{project_id}/source/upload`

**请求类型：** `multipart/form-data`。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | file | 是 | 单个 TXT 文件，按公共文件大小及编码限制校验 |

不同时接受 text 字段。

**返回：** HTTP 201。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `project_id` | UUID | 否 | 项目 ID |
| `source_text` | string | 否 | 已保存原文 |
| `source_type` | string | 否 | text 或 txt，取决于提交接口 |
| `source_asset_id` | UUID | 是 | 上传 TXT 资产 ID；文本提交为 null |
| `source_hash` | string | 否 | 规范化正文摘要 |
| `source_submitted` | boolean | 否 | 成功提交后为 true |
| `source_submitted_at` | datetime | 否 | 原文提交并锁定的时间 |

本接口 source_type 固定为 txt，source_asset_id 返回本次保留的 TXT 资产 ID。

**数据库逻辑：** 检查大小、UTF-8／BOM、非空正文和字符限制，不只检查后缀。临时保存文件后，事务内锁定项目，检查未提交，登记 assets 并写入项目正文、资产 ID、摘要及时间。数据库失败时清理未引用临时文件。项目已提交返回 SOURCE_LOCKED，不能再次上传替换。

错误：`413 FILE_TOO_LARGE`、`415 INVALID_FILE_TYPE`、`422 FILE_DECODE_ERROR`、`422 TEXT_EMPTY`、`422 TEXT_TOO_LONG`。

## 4 脚本模块

### S-01 生成或重新生成脚本

`POST /api/v1/projects/{project_id}/script/generate`

**功能：** 首次生成与重新生成共用，均创建后台脚本任务；成功后新增一版脚本。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `roles` | array | 是 | 1—8 个角色，按生成时使用的顺序排列；本版支持范围建议，各模型仍需能力校验 |
| `roles[].profile_id` | UUID | 是 | 当前用户已启用的角色模板 |
| `roles[].role_key` | string | 是 | 脚本内唯一标识，1—64 位字母、数字或下划线 |

使用 C-11 已保存的项目 LLM 配置。角色模板在此处明确选择，参数中不传密钥、模型端点或数据库生成的脚本 ID。

**返回：** HTTP 202。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `task_id` | UUID | 否 | 当前生成或合并操作的任务 ID |
| `task_type` | string | 否 | script 或 audio |
| `audio_action` | string | 是 | preview、full、regenerate；脚本任务为 null |
| `status` | string | 否 | 首次受理为 queued，幂等重放为原任务当前状态 |
| `script_id` | UUID | 是 | 来源或结果脚本 ID；脚本生成首次受理时为 null |
| `audio_version_id` | UUID | 是 | 正式音频版本 ID；脚本生成和试听为 null |
| `candidate_id` | UUID | 是 | 候选 ID；无候选的任务为 null |
| `status_url` | string | 否 | 任务详情查询路径 |

task_type=script，audio_action=null；首次受理 script_id、audio_version_id、candidate_id 均为 null。

**数据库逻辑：** 验证项目原文已提交、模型及凭据可用、角色模板属于用户。复制原文、角色、Prompt、LLM 有效配置到 tasks.input_snapshot，保存 credential_id 后投递。成功时在事务内分配 version，插入 scripts、script_roles、script_sentences，更新 projects.current_script_id 及任务结果。不会取消旧确认，也不会覆盖旧脚本。

同项目已有脚本生成任务时返回 `409 TASK_ALREADY_RUNNING` 及可通过 P-03／T-02 找回的任务；同幂等键按公共规则复用。无原文返回 SOURCE_NOT_SUBMITTED，无有效配置返回 MODEL_NOT_CONFIGURED。

### S-02 查询各版脚本

`GET /api/v1/projects/{project_id}/scripts`

**查询参数：** 公共分页；`status` 可选 draft 或 confirmed。按 version 降序排列。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `items` | array | 否 | 当前页记录，无记录时为 [] |
| `page` | integer | 否 | 当前页码 |
| `page_size` | integer | 否 | 每页条数 |
| `total` | integer | 否 | 符合条件的总记录数 |
| `items[].script_id` | UUID | 否 | 脚本 ID |
| `items[].project_id` | UUID | 否 | 所属项目 |
| `items[].version` | integer | 否 | 项目内 LLM 生成版本 |
| `items[].edit_revision` | integer | 否 | 该版脚本的内部编辑修订号 |
| `items[].title` | string | 否 | 脚本标题 |
| `items[].summary` | string | 是 | 脚本简介 |
| `items[].status` | string | 否 | draft 或 confirmed |
| `items[].sentence_count` | integer | 否 | 句子总数 |
| `items[].confirmed_at` | datetime | 是 | 当前确认时间，未确认为 null |
| `items[].created_at` | datetime | 否 | 创建时间 |
| `items[].updated_at` | datetime | 否 | 更新时间 |

**数据库逻辑：** 根据项目归属读取 scripts 和句子计数，前端可选择任意版本查看，不限定只取 current_script_id。

### S-03 脚本详情

`GET /api/v1/scripts/{script_id}`

**参数：** script_id 为路径 UUID，无请求体。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `script_id` | UUID | 否 | 脚本 ID |
| `project_id` | UUID | 否 | 所属项目 |
| `version` | integer | 否 | 展示版本，手动保存不改变 |
| `edit_revision` | integer | 否 | 内部修订号，手动有效保存时递增 |
| `title` | string | 否 | 脚本标题 |
| `summary` | string | 是 | 脚本简介 |
| `status` | string | 否 | draft 或 confirmed |
| `confirmed_at` | datetime | 是 | 当前确认时间 |
| `confirmed_by` | UUID | 是 | 当前确认用户 |
| `confirmed_revision` | integer | 是 | 当前确认的内部修订号 |
| `editable` | boolean | 否 | 是否允许编辑；保存时后端仍重新校验 |
| `roles` | array | 否 | 此脚本的完整角色清单 |
| `sentences` | array | 否 | 按 sequence 升序排列的完整句子清单 |
| `created_at` | datetime | 否 | 创建时间 |
| `updated_at` | datetime | 否 | 更新时间 |
| `roles[].role_id` | UUID | 否 | 此脚本中的实际角色 ID |
| `roles[].profile_id` | UUID | 是 | 来源角色模板 ID |
| `roles[].role_key` | string | 否 | 脚本内角色标识 |
| `roles[].name` | string | 否 | 角色展示名 |
| `roles[].description` | string | 是 | 角色说明 |
| `roles[].voice_config` | object | 否 | 本脚本实际声音配置 |
| `roles[].voice_config.tts_provider` | string | 否 | TTS 提供方 |
| `roles[].voice_config.tts_model` | string | 否 | TTS 模型 |
| `roles[].voice_config.voice_id` | string | 否 | 音色标识 |
| `roles[].voice_config.style` | string | 是 | 表达风格，null 使用音色默认表达 |
| `roles[].voice_config.speed` | number | 否 | 角色默认语速 |
| `roles[].voice_config.extra_params` | object | 否 | 其他已支持参数，无额外参数时为 {} |
| `sentences[].sentence_id` | UUID | 否 | 脚本句 ID |
| `sentences[].sequence` | integer | 否 | 脚本内连续顺序，从 1 开始 |
| `sentences[].role_id` | UUID | 否 | 所属脚本的角色 ID |
| `sentences[].text` | string | 否 | 台词正文 |
| `sentences[].speed` | number | 是 | 句子语速覆盖值；null 继承角色默认值 |
| `sentences[].extra_params` | object | 否 | 句子级参数，无覆盖时为 {} |

**数据库逻辑：** 按项目归属读取 scripts、script_roles、script_sentences。一次读取使用一致的读视图，避免 edit_revision 与句子来自不同保存时刻。editable 仅为提示，保存时仍重新校验。句子 speed=null 表示继承该版脚本角色默认语速。

### S-04 保存整份脚本的修改

`PUT /api/v1/scripts/{script_id}`

**功能：** 前端编辑完点击“保存修改”，一次提交完整可编辑内容，原地更新该展示版本，增加内部修订号。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `expected_script_version` | integer | 是 | 必须等于该 script_id 的 version |
| `expected_edit_revision` | integer | 是 | 必须等于保存前读取的 edit_revision |
| `title` | string | 是 | 1—100 字符 |
| `summary` | string / null | 是 | 当前简介，null 表示清空 |
| `roles` | array | 是 | S-03 的完整角色清单；profile_id 为只读来源字段，不必提交 |
| `roles[].role_id` | UUID | 是 | 本脚本现有角色 ID，不允许改变 |
| `roles[].role_key` | string | 是 | 本脚本角色标识，不允许改变 |
| `roles[].name` | string | 是 | 角色展示名称，允许修改 |
| `roles[].description` | string / null | 是 | 当前说明 |
| `roles[].voice_config` | object | 是 | 角色声音配置，各字段值及范围由 C-12 返回的能力约束确定 |
| `roles[].voice_config.tts_provider` | string | 是 | 已接入的 TTS 提供方 |
| `roles[].voice_config.tts_model` | string | 是 | 该提供方支持的 TTS 模型 |
| `roles[].voice_config.voice_id` | string | 是 | 与提供方及模型匹配的音色标识 |
| `roles[].voice_config.style` | string / null | 是 | 有效表达风格；null 使用音色默认表达 |
| `roles[].voice_config.speed` | number | 是 | 角色默认语速，范围由音色能力确定 |
| `roles[].voice_config.extra_params` | object | 是 | 其他已支持参数，未使用时为 `{}` |
| `sentences` | array | 是 | 完整句子清单，按 sequence 排列 |
| `sentences[].sentence_id` | UUID | 是 | 本脚本已有句子 ID，不允许改变 |
| `sentences[].sequence` | integer | 是 | 该句原有顺序，不允许通过此接口重排 |
| `sentences[].role_id` | UUID | 是 | 所属脚本的有效角色 ID |
| `sentences[].text` | string | 是 | 非空台词 |
| `sentences[].speed` | number / null | 是 | null 继承角色默认值；数字必须处于声音支持范围 |
| `sentences[].extra_params` | object | 是 | 未使用时为 `{}`，只接受能力目录允许的参数 |

本接口当前修改既有句子正文、角色及参数，以及既有脚本角色配置；不新增、删除句子或角色，不改变 sequence、role_key。完整清单的 ID 集合必须与数据库一致，不能漏传导致隐式删除。新增角色模板通过配置模块完成，生成新脚本时选择。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `script_id` | UUID | 否 | 脚本 ID |
| `project_id` | UUID | 否 | 所属项目 |
| `version` | integer | 否 | 展示版本，手动保存不改变 |
| `edit_revision` | integer | 否 | 内部修订号，手动有效保存时递增 |
| `title` | string | 否 | 脚本标题 |
| `summary` | string | 是 | 脚本简介 |
| `status` | string | 否 | draft 或 confirmed |
| `confirmed_at` | datetime | 是 | 当前确认时间 |
| `confirmed_by` | UUID | 是 | 当前确认用户 |
| `confirmed_revision` | integer | 是 | 当前确认的内部修订号 |
| `editable` | boolean | 否 | 是否允许编辑；保存时后端仍重新校验 |
| `roles` | array | 否 | 此脚本的完整角色清单 |
| `sentences` | array | 否 | 按 sequence 升序排列的完整句子清单 |
| `created_at` | datetime | 否 | 创建时间 |
| `updated_at` | datetime | 否 | 更新时间 |
| `roles[].role_id` | UUID | 否 | 此脚本中的实际角色 ID |
| `roles[].profile_id` | UUID | 是 | 来源角色模板 ID |
| `roles[].role_key` | string | 否 | 脚本内角色标识 |
| `roles[].name` | string | 否 | 角色展示名 |
| `roles[].description` | string | 是 | 角色说明 |
| `roles[].voice_config` | object | 否 | 本脚本实际声音配置 |
| `roles[].voice_config.tts_provider` | string | 否 | TTS 提供方 |
| `roles[].voice_config.tts_model` | string | 否 | TTS 模型 |
| `roles[].voice_config.voice_id` | string | 否 | 音色标识 |
| `roles[].voice_config.style` | string | 是 | 表达风格，null 使用音色默认表达 |
| `roles[].voice_config.speed` | number | 否 | 角色默认语速 |
| `roles[].voice_config.extra_params` | object | 否 | 其他已支持参数，无额外参数时为 {} |
| `sentences[].sentence_id` | UUID | 否 | 脚本句 ID |
| `sentences[].sequence` | integer | 否 | 脚本内连续顺序，从 1 开始 |
| `sentences[].role_id` | UUID | 否 | 所属脚本的角色 ID |
| `sentences[].text` | string | 否 | 台词正文 |
| `sentences[].speed` | number | 是 | 句子语速覆盖值；null 继承角色默认值 |
| `sentences[].extra_params` | object | 否 | 句子级参数，无覆盖时为 {} |

version 不变；有有效修改时 edit_revision+1，无实际变化保持不变。

**数据库逻辑：** 锁定 scripts，校验 draft、版本和内部修订；校验角色关系、语音能力和正文限制，事务内更新 script_roles／script_sentences 及脚本标题、简介、edit_revision。保留已有音频快照和文件。已确认返回 SCRIPT_LOCKED，修订不匹配返回 REVISION_CONFLICT。

### S-05 保存单句修改

`PATCH /api/v1/scripts/{script_id}/sentences/{sentence_id}`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `expected_script_version` | integer | 是 | 必须等于该 script_id 的展示 version，与 S-04 相同 |
| `expected_edit_revision` | integer | 是 | 必须等于保存前读取的 edit_revision，与 S-04 相同 |
| `text` | string | 否 | 新台词，不能为 null 或空白 |
| `role_id` | UUID | 否 | 本脚本既有角色，不能为 null |
| `speed` | number / null | 否 | 省略不修改，显式 null 恢复继承 |
| `extra_params` | object | 否 | 省略不修改；传入时整体替换，`{}` 清空覆盖参数 |

四个可编辑字段至少提供一个，不接收 sequence 或句子主键修改。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `script_id` | UUID | 否 | 所属脚本 ID |
| `version` | integer | 否 | 脚本展示版本，手动修改不变 |
| `edit_revision` | integer | 否 | 保存后的脚本内部修订号，前端必须更新 |
| `status` | string | 否 | 保存后为 draft |
| `sentence` | object | 否 | 修改后的完整句子 |
| `sentence.sentence_id` | UUID | 否 | 脚本句 ID |
| `sentence.sequence` | integer | 否 | 脚本内连续顺序，从 1 开始 |
| `sentence.role_id` | UUID | 否 | 所属脚本的角色 ID |
| `sentence.text` | string | 否 | 台词正文 |
| `sentence.speed` | number | 是 | 句子语速覆盖值；null 继承角色默认值 |
| `sentence.extra_params` | object | 否 | 句子级参数，无覆盖时为 {} |

**数据库逻辑：** 使用 S-04 同一保存服务及事务规则。只修改目标句子，但递增整份脚本 edit_revision，不单独增加句子版本；前端必须更新本地整体内部修订号。

### S-06 确认脚本

`POST /api/v1/scripts/{script_id}/confirm`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `expected_script_version` | integer | 是 | 用户审核的脚本展示版本，必须与目标脚本一致 |
| `expected_edit_revision` | integer | 是 | 用户审核的内部修订号，必须与当前内容一致 |

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `script_id` | UUID | 否 | 目标脚本 ID |
| `version` | integer | 否 | 脚本展示版本 |
| `edit_revision` | integer | 否 | 当前内部修订号 |
| `status` | string | 否 | 确认接口为 confirmed，取消确认接口为 draft |
| `confirmed_revision` | integer | 是 | 确认时等于 edit_revision，取消后为 null |
| `confirmed_by` | UUID | 是 | 确认用户 ID，取消后为 null |
| `confirmed_at` | datetime | 是 | 确认时间，取消后为 null |

成功后 status=confirmed，三个确认字段均非空。

**数据库逻辑：** 先锁项目再锁脚本，检查版本、修订、非空台词、角色及声音参数。若其他脚本已确认，返回 `409 ANOTHER_SCRIPT_CONFIRMED`，不能自动替用户取消；否则写 scripts 的确认字段，唯一约束保证一个项目最多一版 confirmed。相同脚本及修订重复确认返回原确认结果，不重写确认时间。

### S-07 取消确认

`POST /api/v1/scripts/{script_id}/unconfirm`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `expected_script_version` | integer | 是 | 目标脚本的展示版本 |
| `expected_edit_revision` | integer | 是 | 用户读取到的目标脚本内部修订号 |

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `script_id` | UUID | 否 | 目标脚本 ID |
| `version` | integer | 否 | 脚本展示版本 |
| `edit_revision` | integer | 否 | 当前内部修订号 |
| `status` | string | 否 | 确认接口为 confirmed，取消确认接口为 draft |
| `confirmed_revision` | integer | 是 | 确认时等于 edit_revision，取消后为 null |
| `confirmed_by` | UUID | 是 | 确认用户 ID，取消后为 null |
| `confirmed_at` | datetime | 是 | 确认时间，取消后为 null |

成功后 status=draft，confirmed_revision、confirmed_by、confirmed_at 均为 null。

**数据库逻辑：** 与确认使用同一锁顺序，清空当前确认字段，不增加 edit_revision。已经是同修订 draft 时幂等成功。已受理音频任务继续使用快照；取消后禁止创建该脚本的新试听／完整生成，历史音频和候选不删除。

## 5 语音模块

### A-01 生成前三句试听

`POST /api/v1/projects/{project_id}/audio/preview`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `script_id` | UUID | 是 | 本项目已确认的脚本 ID |
| `expected_script_version` | integer | 是 | 用户读取到的脚本展示版本 |
| `expected_edit_revision` | integer | 是 | 用户读取到的已确认脚本内部修订号 |

**返回：** HTTP 202。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `task_id` | UUID | 否 | 当前生成或合并操作的任务 ID |
| `task_type` | string | 否 | script 或 audio |
| `audio_action` | string | 是 | preview、full、regenerate；脚本任务为 null |
| `status` | string | 否 | 首次受理为 queued，幂等重放为原任务当前状态 |
| `script_id` | UUID | 是 | 来源或结果脚本 ID；脚本生成首次受理时为 null |
| `audio_version_id` | UUID | 是 | 正式音频版本 ID；脚本生成和试听为 null |
| `candidate_id` | UUID | 是 | 候选 ID；无候选的任务为 null |
| `status_url` | string | 否 | 任务详情查询路径 |

task_type=audio，audio_action=preview，audio_version_id、candidate_id 均为 null。

**数据库逻辑：** 校验脚本属于项目且为当前确认版本、confirmed_revision 与请求修订一致。按 sequence 取前三句，不足三句取全部，不截断句子；冻结正文、角色及有效配置，写 tasks。后台生成试听资产后更新 tasks.result_asset_id／result_json，不写 audio_versions。试听与完整生成使用相同的脚本声音配置。

### A-02 完整生成音频

`POST /api/v1/projects/{project_id}/audio/generate`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `script_id` | UUID | 是 | 本项目已确认的脚本 ID |
| `expected_script_version` | integer | 是 | 用户读取到的脚本展示版本 |
| `expected_edit_revision` | integer | 是 | 用户读取到的已确认脚本内部修订号 |

调用方不传音频 version，不传逐句文本或密钥。

**返回：** HTTP 202。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `task_id` | UUID | 否 | 当前生成或合并操作的任务 ID |
| `task_type` | string | 否 | script 或 audio |
| `audio_action` | string | 是 | preview、full、regenerate；脚本任务为 null |
| `status` | string | 否 | 首次受理为 queued，幂等重放为原任务当前状态 |
| `script_id` | UUID | 是 | 来源或结果脚本 ID；脚本生成首次受理时为 null |
| `audio_version_id` | UUID | 是 | 正式音频版本 ID；脚本生成和试听为 null |
| `candidate_id` | UUID | 是 | 候选 ID；无候选的任务为 null |
| `status_url` | string | 否 | 任务详情查询路径 |

task_type=audio，audio_action=full，audio_version_id 为新分配版本 ID，candidate_id 为 null。

**数据库逻辑：** 按项目→脚本顺序锁定并校验确认状态，在事务中分配项目内音频 version，保存 audio_versions 的脚本／配置快照，创建全量 audio_sentences 及任务。后台逐句执行，前端通过 A-05 查询已就绪片段；全部成功后按快照顺序合并。校验存储完成后原子更新版本 ready、当前完整资产、selection_revision=1 及任务成功结果。

此接口一次受理整篇，不让前端逐句调用。相同项目、相同脚本及修订已有 full 任务 queued／running 时返回 TASK_ALREADY_RUNNING；同幂等键复用原任务。已生成完后用户再次明确发起完整生成可创建新音频版本。

### A-03 正式音频版本列表

`GET /api/v1/projects/{project_id}/audio-versions`

**查询参数：** 公共分页；`script_id: UUID` 可选；`status` 可选 queued、running、ready、failed。按 version 降序返回。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `items` | array | 否 | 当前页记录，无记录时为 [] |
| `page` | integer | 否 | 当前页码 |
| `page_size` | integer | 否 | 每页条数 |
| `total` | integer | 否 | 符合条件的总记录数 |
| `items[].audio_version_id` | UUID | 否 | 正式音频版本 ID |
| `items[].version` | integer | 否 | 项目内音频版本，单句重生成不改变 |
| `items[].script_id` | UUID | 否 | 来源脚本 ID |
| `items[].script_version` | integer | 否 | 来源脚本展示版本 |
| `items[].script_edit_revision` | integer | 否 | 音频受理时的脚本内部修订号 |
| `items[].status` | string | 否 | queued、running、ready、failed |
| `items[].selection_revision` | integer | 否 | 当前音频选用结果的内部修订号 |
| `items[].current_asset_id` | UUID | 是 | 当前完整 MP3 资产，尚无成品时为 null |
| `items[].duration_ms` | integer | 是 | 当前完整 MP3 时长，毫秒 |
| `items[].size_bytes` | integer | 是 | 当前完整 MP3 大小，字节 |
| `items[].download_url` | string | 是 | 当前成品的受控下载路径 |
| `items[].created_at` | datetime | 否 | 创建时间 |
| `items[].updated_at` | datetime | 否 | 更新时间 |

尚未产生成品时，文件相关字段为 null。

**数据库逻辑：** 读取 audio_versions，关联来源 scripts 和当前 assets。列表仅包含正式版本，不把试听和候选混入。元数据中的 script_edit_revision 是受理修订，不取脚本现在的 edit_revision 替代。

### A-04 正式音频详情

`GET /api/v1/audio-versions/{audio_version_id}`

**参数：** 路径 UUID。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `audio_version_id` | UUID | 否 | 正式音频版本 ID |
| `version` | integer | 否 | 项目内音频版本，单句重生成不改变 |
| `script_id` | UUID | 否 | 来源脚本 ID |
| `script_version` | integer | 否 | 来源脚本展示版本 |
| `script_edit_revision` | integer | 否 | 音频受理时的脚本内部修订号 |
| `status` | string | 否 | queued、running、ready、failed |
| `selection_revision` | integer | 否 | 当前音频选用结果的内部修订号 |
| `current_asset_id` | UUID | 是 | 当前完整 MP3 资产，尚无成品时为 null |
| `duration_ms` | integer | 是 | 当前完整 MP3 时长，毫秒 |
| `size_bytes` | integer | 是 | 当前完整 MP3 大小，字节 |
| `download_url` | string | 是 | 当前成品的受控下载路径 |
| `created_at` | datetime | 否 | 创建时间 |
| `updated_at` | datetime | 否 | 更新时间 |
| `project_id` | UUID | 否 | 所属项目 |
| `script_snapshot` | object | 否 | 不可变的标题、角色、有序句子、正文、语速及确认信息，不含密钥 |
| `config_snapshot` | object | 否 | 初次完整生成实际使用的模型、音色、风格及参数，不含密钥 |
| `play_url` | string | 是 | 当前完整 MP3 播放路径，未就绪为 null |
| `source_script_changed` | boolean | 否 | 来源脚本当前修订是否与生成时的修订不同 |
| `active_tasks` | array | 否 | 此音频版本下的 queued／running 任务摘要，无任务为 [] |
| `active_tasks[].task_id` | UUID | 否 | 任务 ID |
| `active_tasks[].task_type` | string | 否 | script 或 audio |
| `active_tasks[].audio_action` | string | 是 | 音频操作类型；脚本任务为 null |
| `active_tasks[].stage` | string | 否 | 当前执行阶段 |
| `active_tasks[].status_url` | string | 否 | 查询任务详情的路径 |

**数据库逻辑：** 通过项目归属鉴权，读取冻结快照及当前成品元数据；历史台词以快照为准。active_tasks 返回此音频版本下 queued／running 的任务摘要，候选选择或重试失败不会让原来 ready 的成品失效。

### A-05 逐句生成进度与播放清单

`GET /api/v1/audio-versions/{audio_version_id}/sentences`

**参数：** 路径 UUID，无分页。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `audio_version_id` | UUID | 否 | 目标正式音频版本 ID |
| `version` | integer | 否 | 音频展示版本 |
| `selection_revision` | integer | 否 | 当前选用结果的内部修订号 |
| `total_sentences` | integer | 否 | 完整句段总数 |
| `completed_sentences` | integer | 否 | 初次合成成功的句段数 |
| `failed_sentences` | integer | 否 | 初次合成失败的句段数 |
| `sentences` | array | 否 | 全部句段，包括排队、处理中和失败项，按 sequence 排序 |
| `sentences[].audio_sentence_id` | UUID | 否 | 音频版本中的句段 ID，用于单句重生成 |
| `sentences[].source_sentence_id` | UUID | 否 | 来源脚本句 ID，仅用于追溯 |
| `sentences[].sequence` | integer | 否 | 冻结的合并顺序 |
| `sentences[].text` | string | 否 | 冻结台词 |
| `sentences[].role` | object | 否 | 冻结的角色标识与名称 |
| `sentences[].current_params` | object | 否 | 当前片段有效声音参数，不含凭据 |
| `sentences[].status` | string | 否 | queued、running、succeeded、failed |
| `sentences[].current_asset_id` | UUID | 是 | 当前片段资产 ID |
| `sentences[].play_url` | string | 是 | 已就绪片段的播放路径 |
| `sentences[].duration_ms` | integer | 是 | 当前片段时长，毫秒 |
| `sentences[].error_message` | string | 是 | 初次合成错误；无错误时为 null |
| `sentences[].has_ready_candidates` | boolean | 否 | 是否存在待选择候选 |

**数据库逻辑：** 返回此版本的所有 audio_sentences，包括排队、未生成和失败项，按 sequence 排序；关联 assets 和候选状态。不能把“没有文件”一律当作“从未生成”。查询结果应来自一致读视图，以保证 selection_revision 与当前片段一致。

### A-06 重新生成指定句子的候选

`POST /api/v1/audio-sentences/{audio_sentence_id}/regenerate`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `expected_selection_revision` | integer | 是 | 当前音频版本的内部选用修订号，从 A-04／A-05 读取 |

**返回：** HTTP 202。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `task_id` | UUID | 否 | 当前生成或合并操作的任务 ID |
| `task_type` | string | 否 | script 或 audio |
| `audio_action` | string | 是 | preview、full、regenerate；脚本任务为 null |
| `status` | string | 否 | 首次受理为 queued，幂等重放为原任务当前状态 |
| `script_id` | UUID | 是 | 来源或结果脚本 ID；脚本生成首次受理时为 null |
| `audio_version_id` | UUID | 是 | 正式音频版本 ID；脚本生成和试听为 null |
| `candidate_id` | UUID | 是 | 候选 ID；无候选的任务为 null |
| `status_url` | string | 否 | 任务详情查询路径 |

task_type=audio，audio_action=regenerate；返回目标 audio_version_id 和新 candidate_id，当前成品暂不改变。

**数据库逻辑：** 校验目标音频版本已 ready、有有效原片段且修订匹配。复制该音频句段的冻结台词和当前有效参数，写 regenerate 任务及 pending 候选。成功时保存候选资产，候选变 ready，任务成功结果指明 requires_selection=true；不更新当前片段或完整成品。

本版只重新合成同一句、同一有效配置，不接收 text、feedback 或任意参数覆盖。自然语言改稿和选项调优暂不在此接口启用。音频快照此前已确认，重生成不读取后来改动的脚本。该句已有运行候选任务时返回 TASK_ALREADY_RUNNING。

### A-07 查询候选片段

`GET /api/v1/audio-sentences/{audio_sentence_id}/candidates`

**查询参数：** 公共分页；`status` 可选 pending、ready、accepted、discarded、failed。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `audio_sentence_id` | UUID | 否 | 目标音频句段 ID |
| `audio_version_id` | UUID | 否 | 所属正式音频版本 ID |
| `current_asset_id` | UUID | 否 | 当前有效原片段资产 ID |
| `current_play_url` | string | 否 | 当前有效原片段播放路径 |
| `selection_revision` | integer | 否 | 当前音频版本选用修订号 |
| `items` | array | 否 | 当前页记录，无记录时为 [] |
| `page` | integer | 否 | 当前页码 |
| `page_size` | integer | 否 | 每页条数 |
| `total` | integer | 否 | 符合条件的总记录数 |
| `items[].candidate_id` | UUID | 否 | 候选 ID |
| `items[].task_id` | UUID | 否 | 产生候选的任务 ID |
| `items[].status` | string | 否 | pending、ready、accepted、discarded、failed |
| `items[].base_asset_id` | UUID | 否 | 发起重生成时使用的原片段资产 |
| `items[].base_selection_revision` | integer | 否 | 发起重生成时的选用修订号 |
| `items[].asset_id` | UUID | 是 | 候选片段资产，未生成成功时为 null |
| `items[].play_url` | string | 是 | 候选片段播放路径 |
| `items[].duration_ms` | integer | 是 | 候选时长，毫秒 |
| `items[].is_current` | boolean | 否 | 候选是否正在被选用，不能只依据 accepted 判断 |
| `items[].is_stale` | boolean | 否 | 尚未采用的候选基准是否已与当前结果不一致 |
| `items[].created_at` | datetime | 否 | 候选创建时间 |
| `items[].decided_at` | datetime | 是 | 用户选择完成时间，未决定为 null |

**数据库逻辑：** 查询 audio_candidates 及 assets。is_current 由当前片段是否等于候选资产计算，accepted 仅表示曾被采用；未采用且基准片段／修订与当前不一致时 is_stale=true。此状态是查询计算结果，不另建状态字段。无文件的候选仍返回，以便恢复进度。

### A-08 选择保留原片段或采用候选

`POST /api/v1/audio-candidates/{candidate_id}/decision`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `choice` | string | 是 | `keep_original` 或 `use_candidate` |
| `expected_selection_revision` | integer | 是 | 用户作出选择时看到的音频内部修订号 |

**返回：** 根据选择返回 HTTP 200 或 202。

**返回 data（keep_original，HTTP 200）：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `candidate_id` | UUID | 否 | 被丢弃的新候选 ID |
| `status` | string | 否 | discarded |
| `audio_version_id` | UUID | 否 | 目标音频版本 ID |
| `selection_revision` | integer | 否 | 保持原值，不增加 |
| `current_asset_id` | UUID | 否 | 继续使用的当前完整 MP3 资产 ID |

**返回 data（use_candidate，HTTP 202）：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `task_id` | UUID | 否 | 当前生成或合并操作的任务 ID |
| `task_type` | string | 否 | script 或 audio |
| `audio_action` | string | 是 | preview、full、regenerate；脚本任务为 null |
| `status` | string | 否 | 首次受理为 queued，幂等重放为原任务当前状态 |
| `script_id` | UUID | 是 | 来源或结果脚本 ID；脚本生成首次受理时为 null |
| `audio_version_id` | UUID | 是 | 正式音频版本 ID；脚本生成和试听为 null |
| `candidate_id` | UUID | 是 | 候选 ID；无候选的任务为 null |
| `status_url` | string | 否 | 任务详情查询路径 |

新任务 task_type=audio、audio_action=regenerate，返回既有 candidate_id 和目标 audio_version_id，stage 区分 merging 与 synthesizing。

**返回 data（已采用且仍为当前选用结果，重复 use_candidate，HTTP 200）：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `candidate_id` | UUID | 否 | 已采用的候选 ID |
| `audio_version_id` | UUID | 否 | 目标正式音频版本 ID |
| `selection_revision` | integer | 否 | 当前选用修订号，重复操作不递增 |
| `current_asset_id` | UUID | 否 | 当前完整 MP3 资产 ID，不重新合并 |

**数据库逻辑：** 候选必须 ready；保留原片段只更新候选 discarded 和 decided_at。采用候选时检查基准修订和原片段未变，创建关联候选的合并任务，将选择及拟使用清单写入任务快照，不再次调用 TTS。

后台合并新 MP3 后，锁定 audio_versions 再次校验基准；同事务更新目标句段当前片段、当前参数、完整成品引用、selection_revision+1、候选 accepted 和任务结果。音频展示 version 不变。合并失败或最终冲突保留原成品，候选保持 ready，任务失败；允许重试或重新决定。

同一音频版本的候选合并串行受理；运行中不能丢弃正在被采用的候选。已 discarded 再次 keep_original 幂等成功；已 accepted 且仍为当前片段时再次 use_candidate 返回 200 当前结果，不重新合并。相反决定、陈旧基准或已被替换的 accepted 候选返回 409。

### A-09 播放试听、片段或完整音频

`GET /api/v1/audio-assets/{asset_id}/play`

**参数：** asset_id 为路径 UUID，可选标准 HTTP `Range` 请求头；不接受磁盘路径或文件名定位。

**返回：** 成功返回音频流，不包含 JSON data。

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `响应体` | binary | 否 | 完整 MP3 或指定范围的 MP3 字节 |
| `Content-Type` | string | 否 | audio/mpeg |
| `Content-Disposition` | string | 否 | inline |
| `Accept-Ranges` | string | 否 | bytes |
| `Content-Length` | integer | 否 | 本次响应的字节数 |
| `Content-Range` | string | 是 | HTTP 206 时返回实际范围；完整 200 不发送该头 |

完整读取为 HTTP 200；合法单段范围为 206，并返回准确 Content-Range。无法满足的范围为 416，携带 Content-Range: bytes */总字节数；不支持的多段范围可忽略 Range 返回完整 200。表中可空的响应头指该条件下不发送，不发送字面量 null。

**数据库逻辑：** 查询 assets 并通过所属用户和业务关联鉴权，确认类型为 preview、segment 或 full_audio、状态 ready 且文件存在可读取。使用受控 object_key 流式读取，不一次性加载完整大文件。失败按公共 JSON 错误返回，416 可在无正文情况下返回标准范围错误头。

### A-10 下载完整 MP3

`GET /api/v1/audio-assets/{asset_id}/download`

**参数：** 路径 UUID，无请求体。

**返回：** HTTP 200，二进制 MP3，不包含 JSON data。

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `响应体` | binary | 否 | 完整 MP3 文件 |
| `Content-Type` | string | 否 | audio/mpeg |
| `Content-Disposition` | string | 否 | attachment，含安全 ASCII filename 和 UTF-8 filename* |
| `Content-Length` | integer | 否 | 文件字节数 |

下载名为“安全项目标题_音频版本.mp3”，空标题回退为“播客音频”。

**数据库逻辑：** 与 A-09 同样鉴权，仅允许 full_audio 的 ready 资产，检查实际文件。使用音频版本返回的 current_asset_id 可下载当前成品；持有历史任务结果资产 ID 时仍可下载该任务当时的、尚未清理的成品，不能悄悄替换成最新文件。文件缺失返回 AUDIO_FILE_MISSING，不假装下载成功。

## 6 任务模块

### T-01 任务详情

`GET /api/v1/tasks/{task_id}`

**参数：** 路径 UUID。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `task_id` | UUID | 否 | 任务 ID |
| `project_id` | UUID | 否 | 所属项目 |
| `task_type` | string | 否 | script 或 audio |
| `audio_action` | string | 是 | preview、full、regenerate；脚本任务为 null |
| `script_id` | UUID | 是 | 来源或结果脚本 ID |
| `audio_version_id` | UUID | 是 | 关联正式音频版本 ID |
| `audio_sentence_id` | UUID | 是 | 关联音频句段 ID |
| `retry_of_task_id` | UUID | 是 | 被重试的原失败任务 ID |
| `status` | string | 否 | queued、running、succeeded、failed |
| `stage` | string | 否 | queued、calling_llm、validating、synthesizing、merging、saving、completed、failed 中的适用值 |
| `progress` | integer | 是 | 0—100；无法准确计算时为 null |
| `total_sentences` | integer | 否 | 总句数，默认 0；脚本任务通常为 0 |
| `completed_sentences` | integer | 否 | 成功句数，默认 0 |
| `failed_sentences` | integer | 否 | 失败句数，默认 0 |
| `result` | object | 是 | 成功结果见下列分类型表；未成功时为 null |
| `error_code` | string | 是 | 失败业务码，非失败状态为 null |
| `error_message` | string | 是 | 失败原因，非失败状态为 null |
| `can_retry` | boolean | 否 | 后端计算是否可重试，实际提交仍校验冲突 |
| `result_asset_id` | UUID | 是 | 该任务实际产物，不随音频版本后续选择变化 |
| `created_at` | datetime | 否 | 创建时间 |
| `updated_at` | datetime | 否 | 更新时间 |
| `started_at` | datetime | 是 | 实际开始时间，未开始为 null |
| `finished_at` | datetime | 是 | 结束时间，未结束为 null |

**result 子字段（脚本生成成功）：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `result.script_id` | UUID | 否 | 生成的脚本 ID |
| `result.version` | integer | 否 | 新脚本展示版本 |
| `result.edit_revision` | integer | 否 | 初始内部修订号 |
| `result.sentence_count` | integer | 否 | 句子总数 |

**result 子字段（试听成功）：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `result.asset_id` | UUID | 否 | 试听资产 ID |
| `result.play_url` | string | 否 | 试听播放路径 |
| `result.duration_ms` | integer | 否 | 试听时长，毫秒 |
| `result.script_id` | UUID | 否 | 来源脚本 ID |
| `result.script_edit_revision` | integer | 否 | 受理时的脚本内部修订号 |
| `result.sentence_count` | integer | 否 | 本次试听实际使用句数 |

**result 子字段（完整音频成功）：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `result.audio_version_id` | UUID | 否 | 正式音频版本 ID |
| `result.version` | integer | 否 | 音频展示版本 |
| `result.selection_revision` | integer | 否 | 发布后的内部选用修订号 |
| `result.asset_id` | UUID | 否 | 本任务产生的完整 MP3 资产 |
| `result.play_url` | string | 否 | 完整 MP3 播放路径 |
| `result.download_url` | string | 否 | 完整 MP3 下载路径 |

**result 子字段（重生成候选成功）：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `result.candidate_id` | UUID | 否 | 待用户选择的候选 ID |
| `result.audio_version_id` | UUID | 否 | 目标正式音频版本 ID |
| `result.asset_id` | UUID | 否 | 新候选片段资产 |
| `result.play_url` | string | 否 | 候选试听路径 |
| `result.requires_selection` | boolean | 否 | 固定为 true，候选尚未替换正式结果 |

**result 子字段（采用候选并合并成功）：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `result.candidate_id` | UUID | 否 | 已采用的候选 ID |
| `result.audio_version_id` | UUID | 否 | 正式音频版本 ID |
| `result.version` | integer | 否 | 音频展示版本，保持不变 |
| `result.selection_revision` | integer | 否 | 替换并合并成功后的内部选用修订号 |
| `result.asset_id` | UUID | 否 | 新完整 MP3 资产 |
| `result.play_url` | string | 否 | 新完整 MP3 播放路径 |
| `result.download_url` | string | 否 | 新完整 MP3 下载路径 |
| `result.requires_selection` | boolean | 否 | 固定为 false，选择已完成 |

**数据库逻辑：** 读取 tasks，关联必要资产生成受控 URL；不返回 input_snapshot、credential_id、原始厂商响应或内部路径。任务 succeeded 不代表候选已被采用，前端必须检查 requires_selection。轮询建议间隔 2 秒，终态停止轮询。

### T-02 项目任务列表

`GET /api/v1/projects/{project_id}/tasks`

**查询参数：** 公共分页；`task_type` 可选 script、audio；`audio_action` 可选 preview、full、regenerate；`status` 可选 queued、running、succeeded、failed；`audio_version_id: UUID` 可选。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `items` | array | 否 | 当前页记录，无记录时为 [] |
| `page` | integer | 否 | 当前页码 |
| `page_size` | integer | 否 | 每页条数 |
| `total` | integer | 否 | 符合条件的总记录数 |
| `items[].task_id` | UUID | 否 | 任务 ID |
| `items[].project_id` | UUID | 否 | 所属项目 |
| `items[].task_type` | string | 否 | script 或 audio |
| `items[].audio_action` | string | 是 | preview、full、regenerate；脚本任务为 null |
| `items[].script_id` | UUID | 是 | 来源或结果脚本 ID |
| `items[].audio_version_id` | UUID | 是 | 关联正式音频版本 ID |
| `items[].audio_sentence_id` | UUID | 是 | 关联音频句段 ID |
| `items[].retry_of_task_id` | UUID | 是 | 被重试的原失败任务 ID |
| `items[].status` | string | 否 | queued、running、succeeded、failed |
| `items[].stage` | string | 否 | queued、calling_llm、validating、synthesizing、merging、saving、completed、failed 中的适用值 |
| `items[].progress` | integer | 是 | 0—100；无法准确计算时为 null |
| `items[].total_sentences` | integer | 否 | 总句数，默认 0；脚本任务通常为 0 |
| `items[].completed_sentences` | integer | 否 | 成功句数，默认 0 |
| `items[].failed_sentences` | integer | 否 | 失败句数，默认 0 |
| `items[].result` | object | 是 | 成功结果的分类型字段见 T-01；未成功时为 null |
| `items[].error_code` | string | 是 | 失败业务码，非失败状态为 null |
| `items[].error_message` | string | 是 | 失败原因，非失败状态为 null |
| `items[].can_retry` | boolean | 否 | 后端计算是否可重试，实际提交仍校验冲突 |
| `items[].result_asset_id` | UUID | 是 | 该任务实际产物，不随音频版本后续选择变化 |
| `items[].created_at` | datetime | 否 | 创建时间 |
| `items[].updated_at` | datetime | 否 | 更新时间 |
| `items[].started_at` | datetime | 是 | 实际开始时间，未开始为 null |
| `items[].finished_at` | datetime | 是 | 结束时间，未结束为 null |

用于刷新和重新登录后的任务恢复；非法筛选类型组合返回 422。result 的分类型子字段见 T-01。

**数据库逻辑：** 根据项目归属和条件查询 tasks；不能只依赖调用方此前保存的 task_id。筛选的音频版本也须属于该项目。

### T-03 重试失败任务

`POST /api/v1/tasks/{task_id}/retry`

**路径参数：** task_id 为失败任务 UUID。

**请求体：** 无。不允许通过重试请求改变文本、模型、凭据或声音参数。

**返回：** HTTP 202。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `task_id` | UUID | 否 | 当前生成或合并操作的任务 ID |
| `task_type` | string | 否 | script 或 audio |
| `audio_action` | string | 是 | preview、full、regenerate；脚本任务为 null |
| `status` | string | 否 | 首次受理为 queued，幂等重放为原任务当前状态 |
| `script_id` | UUID | 是 | 来源或结果脚本 ID；脚本生成首次受理时为 null |
| `audio_version_id` | UUID | 是 | 正式音频版本 ID；脚本生成和试听为 null |
| `candidate_id` | UUID | 是 | 候选 ID；无候选的任务为 null |
| `status_url` | string | 否 | 任务详情查询路径 |

task_id 为新任务 ID；T-01 中 retry_of_task_id 指向原失败任务。其余关联 ID 按原任务类型及重试逻辑确定。

**数据库逻辑：** 校验原任务 failed，未存在相同目标的执行冲突，按原冻结输入创建 tasks。原失败记录不覆盖。

- 脚本任务：用原输入重试，凭据仍需属于用户且可用；成功后分配新脚本版本。
- 试听任务：重用原已确认输入快照，产生新试听资产；不要求后来脚本仍保持确认，不读取新草稿。
- full 任务：沿用已分配的 audio_version_id，不增加音频 version；复用可读取的成功片段，只补做失败部分或合并。
- 候选生成失败：为同一音频句段创建新候选和任务，重新检查当前片段与基准；原失败候选保留，不改写为成功。若基准已变，返回 AUDIO_SELECTION_CONFLICT，要求重新发起重生成。
- 采用候选合并失败：仅重试合并，校验候选仍 ready、基准未变；不重跑 TTS，成功后才更新当前引用。

queued／running 任务不可重试，succeeded 任务也不可通过此接口主动重生成，返回 TASK_NOT_RETRYABLE。服务重启后不可继续的运行任务由后台标为可解释的 failed，查询接口不自行假定成功。

## 7 配置模块

### C-01 可选 LLM 模型

`GET /api/v1/models`

**查询参数：** 公共分页；`provider_code: string` 可选。只返回 enabled 且允许用户使用的目录。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `items` | array | 否 | 当前页记录，无记录时为 [] |
| `page` | integer | 否 | 当前页码 |
| `page_size` | integer | 否 | 每页条数 |
| `total` | integer | 否 | 符合条件的总记录数 |
| `items[].model_id` | UUID | 否 | 模型目录 ID |
| `items[].provider_code` | string | 否 | 提供方标识 |
| `items[].model_code` | string | 否 | 实际模型标识 |
| `items[].name` | string | 否 | 展示名称 |
| `items[].supports_user_key` | boolean | 否 | 是否允许用户自带密钥 |
| `items[].platform_credential_available` | boolean | 否 | 平台凭据是否可用 |
| `items[].default_params` | object | 否 | 默认生成参数，不含密钥 |
| `items[].parameter_schema` | object | 否 | 适配器允许的参数名称、类型、范围及默认值 |

**数据库逻辑：** 查询 llm_models，结合后端适配器和平台凭据状态生成可选能力。不返回 platform_secret_ref、密钥或任意内部地址。用户不能通过此接口新增任意提供方端点。

### C-02 新增个人 LLM 密钥

`POST /api/v1/llm-credentials`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `provider_code` | string | 是 | 已接入并支持个人密钥的提供方 |
| `name` | string | 是 | 1—100 字符的凭据别名 |
| `api_key` | string | 是 | 非空原文，只在请求中提交；不写日志、不回传 |

**返回：** HTTP 201。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `credential_id` | UUID | 否 | 个人凭据 ID |
| `provider_code` | string | 否 | 适用提供方 |
| `name` | string | 否 | 凭据别名 |
| `masked_value` | string | 否 | 密钥掩码，不是密钥原文 |
| `status` | string | 否 | enabled 或 disabled；新增时为 enabled |
| `created_at` | datetime | 否 | 创建时间 |
| `updated_at` | datetime | 否 | 更新时间 |

新增状态为 enabled，不返回 api_key、encrypted_secret 或 key_version。

**数据库逻辑：** 检查提供方目录，使用后端管理的加密密钥加密后写 user_llm_credentials，保存 key_version 与掩码。enabled 表示允许使用，不等于已通过真实厂商请求验证；第一次调用仍处理无效密钥、权限和额度错误。不在新增接口发起收费模型生成。

### C-03 个人密钥列表

`GET /api/v1/llm-credentials`

**查询参数：** 公共分页；provider_code 可选；status 可选 enabled、disabled，默认两者，排除 deleted。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `items` | array | 否 | 当前页记录，无记录时为 [] |
| `page` | integer | 否 | 当前页码 |
| `page_size` | integer | 否 | 每页条数 |
| `total` | integer | 否 | 符合条件的总记录数 |
| `items[].credential_id` | UUID | 否 | 个人凭据 ID |
| `items[].provider_code` | string | 否 | 适用提供方 |
| `items[].name` | string | 否 | 凭据别名 |
| `items[].masked_value` | string | 否 | 密钥掩码，不是密钥原文 |
| `items[].status` | string | 否 | enabled 或 disabled；新增时为 enabled |
| `items[].created_at` | datetime | 否 | 创建时间 |
| `items[].updated_at` | datetime | 否 | 更新时间 |

不返回 api_key、encrypted_secret 或 key_version。

**数据库逻辑：** 按当前 user_id 查询 user_llm_credentials；相同提供方允许有多个别名不同的个人凭据。

### C-04 修改个人密钥信息

`PATCH /api/v1/llm-credentials/{credential_id}`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 否 | 凭据别名，1—100 字符；省略不修改 |
| `status` | string | 否 | enabled 或 disabled；省略不修改 |

至少提供一个字段。不接受修改 provider_code 或 api_key，换密钥时新增凭据再切换项目引用。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `credential_id` | UUID | 否 | 个人凭据 ID |
| `provider_code` | string | 否 | 适用提供方 |
| `name` | string | 否 | 凭据别名 |
| `masked_value` | string | 否 | 密钥掩码，不是密钥原文 |
| `status` | string | 否 | enabled 或 disabled；新增时为 enabled |
| `created_at` | datetime | 否 | 创建时间 |
| `updated_at` | datetime | 否 | 更新时间 |

**数据库逻辑：** 校验所有者并更新 user_llm_credentials。停用立即阻止新任务使用；尚未取得凭据的后台任务失败提示，不能静默改用平台凭据；已发给厂商的请求不承诺能够撤回。

### C-05 删除个人密钥

`DELETE /api/v1/llm-credentials/{credential_id}`

**参数：** 路径 UUID。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `credential_id` | UUID | 否 | 被逻辑删除的个人凭据 ID |
| `status` | string | 否 | deleted |

**数据库逻辑：** 逻辑删除，不物理删除被 projects／tasks 引用的行。禁止新使用及失败重试，历史快照和任务仍可查询。项目若引用该密钥，保留引用并在读取配置时标记不可用，要求用户明确更换，不自动扣平台额度。重复删除本人已删记录幂等成功。

### C-06 角色模板列表

`GET /api/v1/roles`

**查询参数：** 公共分页；status 可选 enabled、disabled，默认两者；排除 deleted。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `items` | array | 否 | 当前页记录，无记录时为 [] |
| `page` | integer | 否 | 当前页码 |
| `page_size` | integer | 否 | 每页条数 |
| `total` | integer | 否 | 符合条件的总记录数 |
| `items[].profile_id` | UUID | 否 | 用户角色模板 ID，与脚本实际 role_id 不同 |
| `items[].name` | string | 否 | 角色名称 |
| `items[].description` | string | 是 | 角色说明 |
| `items[].tts_provider` | string | 否 | TTS 提供方 |
| `items[].tts_model` | string | 否 | TTS 模型 |
| `items[].voice_id` | string | 否 | 音色标识 |
| `items[].style` | string | 是 | 表达风格，null 使用默认表达 |
| `items[].speed` | number | 否 | 角色默认语速 |
| `items[].extra_params` | object | 否 | 附加参数，未设置为 {} |
| `items[].status` | string | 否 | enabled 或 disabled；新增时为 enabled |
| `items[].created_at` | datetime | 否 | 创建时间 |
| `items[].updated_at` | datetime | 否 | 更新时间 |

**数据库逻辑：** 按当前用户查询 role_profiles。此处 profile_id 是模板 ID，S-03 的 role_id 是脚本实际角色 ID，不能混用。

### C-07 新建角色模板

`POST /api/v1/roles`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 1—100 字符 |
| `description` | string / null | 否 | 人设说明，默认 null |
| `tts_provider` | string | 是 | 来自 C-12 的 TTS 提供方 |
| `tts_model` | string | 是 | 来自 C-12 且与提供方匹配的模型 |
| `voice_id` | string | 是 | 来自 C-12 且与提供方、模型匹配的音色 |
| `style` | string / null | 否 | 默认 null，使用音色默认表达 |
| `speed` | number | 否 | 默认 1.0，范围由声音能力定义 |
| `extra_params` | object | 否 | 默认 `{}`，只允许能力目录列出的参数 |

**返回：** HTTP 201。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `profile_id` | UUID | 否 | 用户角色模板 ID，与脚本实际 role_id 不同 |
| `name` | string | 否 | 角色名称 |
| `description` | string | 是 | 角色说明 |
| `tts_provider` | string | 否 | TTS 提供方 |
| `tts_model` | string | 否 | TTS 模型 |
| `voice_id` | string | 否 | 音色标识 |
| `style` | string | 是 | 表达风格，null 使用默认表达 |
| `speed` | number | 否 | 角色默认语速 |
| `extra_params` | object | 否 | 附加参数，未设置为 {} |
| `status` | string | 否 | enabled 或 disabled；新增时为 enabled |
| `created_at` | datetime | 否 | 创建时间 |
| `updated_at` | datetime | 否 | 更新时间 |

新增角色的 status 为 enabled。

**数据库逻辑：** 校验声音和能力组合，插入 role_profiles，user_id 来自会话。TTS 凭据由后端维护，不接收或返回语音服务密钥。

### C-08 修改角色模板

`PATCH /api/v1/roles/{profile_id}`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 否 | 角色名称，1—100 字符；省略不修改，不能为 null |
| `description` | string / null | 否 | 角色说明；省略不修改，显式 null 清空 |
| `tts_provider` | string | 否 | C-12 中的有效提供方；省略不修改，不能为 null |
| `tts_model` | string | 否 | 与修改后提供方匹配的模型；省略不修改，不能为 null |
| `voice_id` | string | 否 | 与修改后提供方及模型匹配的音色；省略不修改，不能为 null |
| `style` | string / null | 否 | 有效表达风格；省略不修改，显式 null 恢复默认表达 |
| `speed` | number | 否 | 音色支持范围内的语速；省略不修改，不能为 null |
| `extra_params` | object | 否 | 传入时整体替换，`{}` 清空；省略不修改，不能为 null |
| `status` | string | 否 | enabled 或 disabled；省略不修改，不能为 null |

至少提供一个字段，修改后的完整声音组合仍需通过能力校验。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `profile_id` | UUID | 否 | 用户角色模板 ID，与脚本实际 role_id 不同 |
| `name` | string | 否 | 角色名称 |
| `description` | string | 是 | 角色说明 |
| `tts_provider` | string | 否 | TTS 提供方 |
| `tts_model` | string | 否 | TTS 模型 |
| `voice_id` | string | 否 | 音色标识 |
| `style` | string | 是 | 表达风格，null 使用默认表达 |
| `speed` | number | 否 | 角色默认语速 |
| `extra_params` | object | 否 | 附加参数，未设置为 {} |
| `status` | string | 否 | enabled 或 disabled；新增时为 enabled |
| `created_at` | datetime | 否 | 创建时间 |
| `updated_at` | datetime | 否 | 更新时间 |

**数据库逻辑：** 校验归属及修改后的完整声音组合，更新 role_profiles。不会自动覆盖 script_roles 或历史音频；修改既有 draft 脚本角色通过 S-04 提交，并递增 edit_revision。模板修改和生成时复制使用短事务协调，任务一旦受理就使用其冻结副本。

### C-09 删除角色模板

`DELETE /api/v1/roles/{profile_id}`

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `profile_id` | UUID | 否 | 被逻辑删除的角色模板 ID |
| `status` | string | 否 | deleted |

**数据库逻辑：** 校验所有者，逻辑删除 role_profiles，禁止新生成任务选择；已复制到 script_roles 的角色信息继续保留，不级联删除脚本和声音快照。重复删除本人已删模板幂等成功。

### C-10 查询项目 LLM 配置

`GET /api/v1/projects/{project_id}/llm-config`

**参数：** 路径项目 UUID。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `project_id` | UUID | 否 | 项目 ID |
| `model_id` | UUID | 是 | 已选择的 LLM 模型目录 ID，未配置为 null |
| `credential_source` | string | 否 | platform 或 user |
| `credential_id` | UUID | 是 | 用户凭据 ID；平台凭据时为 null |
| `params` | object | 否 | 用户覆盖参数，未设置为 {} |
| `available` | boolean | 否 | 当前配置是否满足受理条件，不保证运行请求一定成功 |
| `unavailable_reason` | string | 是 | 不可用原因码；配置可用时为 null |

未选模型时 available=false、unavailable_reason=MODEL_NOT_CONFIGURED；平台凭据时 credential_id=null。

**数据库逻辑：** 读取 projects 上的 LLM 配置，关联 llm_models 和本人 user_llm_credentials 验证状态及提供方匹配，不解密回传。配置可用仅表示当前配置有效，不保证随后模型请求必定成功。

### C-11 保存项目 LLM 配置

`PUT /api/v1/projects/{project_id}/llm-config`

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model_id` | UUID | 是 | C-01 返回的可选模型 |
| `credential_source` | string | 是 | platform 或 user |
| `credential_id` | UUID / null | 是 | user 时必须为本人 enabled 且提供方匹配的凭据；platform 时必须为 null |
| `params` | object | 是 | 用户覆盖参数，未覆盖填 `{}`；未知参数或超出能力范围拒绝 |

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `project_id` | UUID | 否 | 项目 ID |
| `model_id` | UUID | 是 | 已选择的 LLM 模型目录 ID，未配置为 null |
| `credential_source` | string | 否 | platform 或 user |
| `credential_id` | UUID | 是 | 用户凭据 ID；平台凭据时为 null |
| `params` | object | 否 | 用户覆盖参数，未设置为 {} |
| `available` | boolean | 否 | 当前配置是否满足受理条件，不保证运行请求一定成功 |
| `unavailable_reason` | string | 是 | 不可用原因码；配置可用时为 null |

**数据库逻辑：** 校验项目归属、模型、凭据及参数，事务内更新 projects 对应配置字段。新任务读取新配置，已排队或运行任务使用受理快照，不因配置修改而换模型或换付费账户。不自动重新生成脚本。

### C-12 可选音色与语音能力

`GET /api/v1/voices`

**查询参数：** `tts_provider`、`tts_model`、`language` 可选，字符串；返回当前后端已接入能力目录的完整过滤结果，首期不分页。

**返回：** HTTP 200。

**返回 data：**

| 字段 | 类型 | 可为空 | 说明 |
| --- | --- | --- | --- |
| `voices` | array | 否 | 过滤后的完整音色能力目录，无匹配时为 [] |
| `voices[].voice_id` | string | 否 | 音色标识 |
| `voices[].name` | string | 否 | 展示名称 |
| `voices[].tts_provider` | string | 否 | TTS 提供方 |
| `voices[].tts_model` | string | 否 | TTS 模型 |
| `voices[].language` | string | 否 | 支持语言 |
| `voices[].styles` | array[string] | 否 | 支持风格，不支持时为 [] |
| `voices[].default_style` | string | 是 | 默认风格，不支持时为 null |
| `voices[].speed` | object | 否 | 语速支持范围 |
| `voices[].speed.supported` | boolean | 否 | 是否支持语速调整 |
| `voices[].speed.min` | number | 否 | 最小语速倍率 |
| `voices[].speed.max` | number | 否 | 最大语速倍率 |
| `voices[].speed.default` | number | 否 | 默认语速倍率 |
| `voices[].extra_parameter_schema` | object | 否 | 其他支持参数的名称、类型、范围和默认值 |

不支持语速时，supported=false，min、max、default 均为 1.0。

**数据库逻辑：** 当前数据库不单独建立音色目录表，由后端固定配置或 TTS 适配器返回；它用于校验 role_profiles、script_roles 和句子覆盖参数。不返回密钥，不把调整语速当成表达风格的替代。

## 8 公共业务错误码

| 错误码 | HTTP／出现位置 | 含义与处理 |
| --- | --- | --- |
| `INVALID_INPUT` | 422 | 字段类型、范围、未知参数或对象关系不合法 |
| `UNAUTHENTICATED` | 401 | 未登录、会话过期或已撤销，重新登录 |
| `CSRF_FAILED` | 403 | 写请求 CSRF 校验失败 |
| `INVALID_CREDENTIALS` | 401 | 登录凭据错误，统一提示 |
| `USERNAME_EXISTS` | 409 | 注册名已存在 |
| `RESOURCE_NOT_FOUND` | 404 | 资源不存在或不属于当前用户 |
| `SOURCE_LOCKED` | 409 | 原文已经提交，不能覆盖或替换 |
| `SOURCE_NOT_SUBMITTED` | 409 | 尚未提交原文 |
| `TEXT_EMPTY`、`TEXT_TOO_LONG` | 422 | 正文为空或超出当前接口限额 |
| `FILE_TOO_LARGE`、`INVALID_FILE_TYPE`、`FILE_DECODE_ERROR` | 413／415／422 | 文件大小、类型或编码问题 |
| `MODEL_NOT_CONFIGURED` | 409 | 项目尚未选择有效模型 |
| `MODEL_UNAVAILABLE` | 409 或任务错误 | 模型停用、不可用或当前账户无访问权限 |
| `CREDENTIAL_UNAVAILABLE` | 409 或任务错误 | 用户／平台凭据不可用、所属或提供方不匹配 |
| `INVALID_ROLE`、`INVALID_VOICE`、`INVALID_AUDIO_PARAMS` | 422 | 角色、音色或参数能力不合法 |
| `SCRIPT_EMPTY` | 409 | 脚本没有有效台词 |
| `SCRIPT_LOCKED` | 409 | 已确认脚本不能编辑，先取消确认 |
| `SCRIPT_NOT_CONFIRMED` | 409 | 新试听／完整生成必须使用确认脚本 |
| `ANOTHER_SCRIPT_CONFIRMED` | 409 | 同项目其他版本仍处于确认状态 |
| `REVISION_CONFLICT` | 409 | 展示版本或内部编辑修订不匹配，刷新核对 |
| `TASK_ALREADY_RUNNING` | 409 | 已有冲突任务，通过项目任务查询找回 |
| `TASK_NOT_RETRYABLE` | 409 | 当前任务不是可重试失败任务 |
| `IDEMPOTENCY_CONFLICT` | 409 | 相同幂等键对应不同请求 |
| `AUDIO_NOT_READY` | 409 | 目标正式音频或片段还未就绪 |
| `AUDIO_SELECTION_CONFLICT` | 409 | 候选基准或当前选用修订已变化 |
| `CANDIDATE_NOT_READY` | 409 | 候选不可选、已丢弃或决定冲突 |
| `AUDIO_FILE_MISSING` | 404 | 数据库有记录但实际文件缺失，不返回假成功 |
| `LLM_API_ERROR`、`LLM_INVALID_RESPONSE` | 任务错误 | 模型调用失败或结果结构无效 |
| `TTS_API_ERROR`、`AUDIO_MERGE_ERROR` | 任务错误 | 片段合成或合并失败，保留有效旧结果 |
| `WORKER_INTERRUPTED` | 任务错误 | 执行中断且无法继续，可按条件重试 |
| `SERVICE_UNAVAILABLE` | 503 | 受理时必要依赖不可用 |
| `INTERNAL_ERROR` | 500 | 未预期错误，向用户提供 request_id，不暴露内部异常 |

上述错误均使用公共响应结构；任务错误放入 T-01 的 error_code／error_message。具体接口未列出的公共认证、参数和资源错误同样适用。
